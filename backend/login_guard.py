"""
In-process login rate limiting and short lockouts.

Suitable for a single uvicorn worker / local deploy. For multi-worker
production, replace with Redis (or similar) shared state.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Dict, List

from fastapi import HTTPException, status

WINDOW_SECONDS = 15 * 60
MAX_ATTEMPTS_PER_IP = 40
MAX_FAILURES_PER_EMAIL = 5
LOCKOUT_SECONDS = 15 * 60

_lock = threading.Lock()
_attempts_by_ip: Dict[str, List[float]] = defaultdict(list)
# Failures/lockouts are keyed by (ip, email) pair, not email alone. Keying by
# email alone lets anyone who knows a target's address lock that account out
# indefinitely from a different IP with no credentials required — a trivial
# unauthenticated DoS. Scoping to the pair means an attacker can only lock
# out their own attempts against that email from their own IP; the victim's
# own logins from their normal IP are unaffected. The per-IP budget below is
# the (unchanged) backstop against a single attacker just switching emails.
_failures_by_ip_email: Dict[str, List[float]] = defaultdict(list)
_lockout_until: Dict[str, float] = {}


def _pair_key(ip: str, email: str) -> str:
    return f"{ip or 'unknown'}:{(email or '').strip().lower()}"


def _prune(timestamps: List[float], now: float) -> List[float]:
    cutoff = now - WINDOW_SECONDS
    return [t for t in timestamps if t >= cutoff]


def _retry_after_seconds(until: float, now: float) -> int:
    return max(1, int(until - now))


def _cleanup_maps(now: float) -> None:
    """Drop empty / expired keys so the in-memory maps cannot grow without bound."""
    empty_ips = [k for k, v in _attempts_by_ip.items() if not _prune(v, now)]
    for k in empty_ips:
        _attempts_by_ip.pop(k, None)

    empty_pairs = [k for k, v in _failures_by_ip_email.items() if not _prune(v, now)]
    for k in empty_pairs:
        _failures_by_ip_email.pop(k, None)

    expired_lockouts = [k for k, until in _lockout_until.items() if until <= now]
    for k in expired_lockouts:
        _lockout_until.pop(k, None)


def check_login_allowed(ip: str, email: str) -> None:
    """Raise 429 if this IP/email pair is currently rate-limited or locked out."""
    now = time.time()
    ip_key = ip or "unknown"
    pair_key = _pair_key(ip, email)

    with _lock:
        _cleanup_maps(now)

        until = _lockout_until.get(pair_key)
        if until and until > now:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Too many failed attempts from this address for this account. "
                    f"Try again in {_retry_after_seconds(until, now)} seconds."
                ),
                headers={"Retry-After": str(_retry_after_seconds(until, now))},
            )

        ip_times = _prune(_attempts_by_ip[ip_key], now)
        _attempts_by_ip[ip_key] = ip_times
        if len(ip_times) >= MAX_ATTEMPTS_PER_IP:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts from this address. Please wait and try again.",
                headers={"Retry-After": str(WINDOW_SECONDS)},
            )

        pair_times = _prune(_failures_by_ip_email[pair_key], now)
        _failures_by_ip_email[pair_key] = pair_times
        if len(pair_times) >= MAX_FAILURES_PER_EMAIL:
            _lockout_until[pair_key] = now + LOCKOUT_SECONDS
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Too many failed attempts from this address for this account. "
                    f"Try again in {LOCKOUT_SECONDS} seconds."
                ),
                headers={"Retry-After": str(LOCKOUT_SECONDS)},
            )


def record_login_attempt(ip: str) -> None:
    """Count every login POST toward the per-IP budget (success or failure)."""
    now = time.time()
    ip_key = ip or "unknown"
    with _lock:
        times = _prune(_attempts_by_ip[ip_key], now)
        times.append(now)
        _attempts_by_ip[ip_key] = times


def record_login_failure(ip: str, email: str) -> None:
    """Count a failed password check toward the (ip, email) lockout."""
    now = time.time()
    pair_key = _pair_key(ip, email)
    with _lock:
        pair_times = _prune(_failures_by_ip_email[pair_key], now)
        pair_times.append(now)
        _failures_by_ip_email[pair_key] = pair_times
        if len(pair_times) >= MAX_FAILURES_PER_EMAIL:
            _lockout_until[pair_key] = now + LOCKOUT_SECONDS


def record_login_success(ip: str, email: str) -> None:
    pair_key = _pair_key(ip, email)
    with _lock:
        _failures_by_ip_email.pop(pair_key, None)
        _lockout_until.pop(pair_key, None)

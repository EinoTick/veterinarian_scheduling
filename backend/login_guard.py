"""
Login rate limiting and short lockouts.

Backends:
  - memory (default): in-process — fine for single-worker / local
  - redis: shared across workers/replicas when REDIS_URL is set

Env:
  RATE_LIMIT_BACKEND=memory|redis   (default memory)
  REDIS_URL=redis://...             (required when backend=redis)
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict
from typing import Dict, List, Optional, Protocol

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 15 * 60
MAX_ATTEMPTS_PER_IP = 40
MAX_FAILURES_PER_EMAIL = 5
LOCKOUT_SECONDS = 15 * 60

_KEY_PREFIX = "vc:login:"


def _pair_key(ip: str, email: str) -> str:
    return f"{ip or 'unknown'}:{(email or '').strip().lower()}"


def _prune(timestamps: List[float], now: float) -> List[float]:
    cutoff = now - WINDOW_SECONDS
    return [t for t in timestamps if t >= cutoff]


def _retry_after_seconds(until: float, now: float) -> int:
    return max(1, int(until - now))


def _raise_lockout(until: float, now: float) -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=(
            f"Too many failed attempts from this address for this account. "
            f"Try again in {_retry_after_seconds(until, now)} seconds."
        ),
        headers={"Retry-After": str(_retry_after_seconds(until, now))},
    )


def _raise_ip_budget() -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many login attempts from this address. Please wait and try again.",
        headers={"Retry-After": str(WINDOW_SECONDS)},
    )


class LoginRateStore(Protocol):
    def check_allowed(self, ip: str, email: str) -> None: ...
    def record_attempt(self, ip: str) -> None: ...
    def record_failure(self, ip: str, email: str) -> None: ...
    def clear_pair(self, ip: str, email: str) -> None: ...


class MemoryLoginRateStore:
    """All mutating checks run under one lock so concurrent logins cannot race the budgets."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempts_by_ip: Dict[str, List[float]] = defaultdict(list)
        self._failures_by_ip_email: Dict[str, List[float]] = defaultdict(list)
        self._lockout_until: Dict[str, float] = {}

    def _cleanup_unlocked(self, now: float) -> None:
        empty_ips = [k for k, v in self._attempts_by_ip.items() if not _prune(v, now)]
        for k in empty_ips:
            self._attempts_by_ip.pop(k, None)
        empty_pairs = [k for k, v in self._failures_by_ip_email.items() if not _prune(v, now)]
        for k in empty_pairs:
            self._failures_by_ip_email.pop(k, None)
        expired = [k for k, until in self._lockout_until.items() if until <= now]
        for k in expired:
            self._lockout_until.pop(k, None)

    def check_allowed(self, ip: str, email: str) -> None:
        now = time.time()
        ip_key = ip or "unknown"
        pair_key = _pair_key(ip, email)
        with self._lock:
            self._cleanup_unlocked(now)
            until = self._lockout_until.get(pair_key)
            if until and until > now:
                _raise_lockout(until, now)
            ip_times = _prune(self._attempts_by_ip.get(ip_key, []), now)
            self._attempts_by_ip[ip_key] = ip_times
            if len(ip_times) >= MAX_ATTEMPTS_PER_IP:
                _raise_ip_budget()
            # Do NOT re-arm lockout from stale failure timestamps here —
            # lockout is only set in record_failure when a new failure crosses the threshold.

    def record_attempt(self, ip: str) -> None:
        now = time.time()
        ip_key = ip or "unknown"
        with self._lock:
            times = _prune(self._attempts_by_ip.get(ip_key, []), now)
            times.append(now)
            self._attempts_by_ip[ip_key] = times

    def record_failure(self, ip: str, email: str) -> None:
        now = time.time()
        pair_key = _pair_key(ip, email)
        with self._lock:
            pair_times = _prune(self._failures_by_ip_email.get(pair_key, []), now)
            pair_times.append(now)
            self._failures_by_ip_email[pair_key] = pair_times
            if len(pair_times) >= MAX_FAILURES_PER_EMAIL:
                self._lockout_until[pair_key] = now + LOCKOUT_SECONDS

    def clear_pair(self, ip: str, email: str) -> None:
        pair_key = _pair_key(ip, email)
        with self._lock:
            self._failures_by_ip_email.pop(pair_key, None)
            self._lockout_until.pop(pair_key, None)


_REDIS_CHECK_SCRIPT = """
-- KEYS[1]=ip zset, KEYS[2]=lock key
-- ARGV[1]=now, ARGV[2]=window, ARGV[3]=max_ip
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_ip = tonumber(ARGV[3])
local cutoff = now - window

local until_raw = redis.call('GET', KEYS[2])
if until_raw then
  local until_ts = tonumber(until_raw)
  if until_ts and until_ts > now then
    return {1, until_ts}
  end
  redis.call('DEL', KEYS[2])
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local ip_count = redis.call('ZCARD', KEYS[1])
if ip_count >= max_ip then
  return {2, 0}
end
return {0, 0}
"""

_REDIS_ATTEMPT_SCRIPT = """
-- KEYS[1]=ip zset
-- ARGV[1]=now, ARGV[2]=member, ARGV[3]=window
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('EXPIRE', KEYS[1], window + 60)
return redis.call('ZCARD', KEYS[1])
"""

_REDIS_FAILURE_SCRIPT = """
-- KEYS[1]=fail zset, KEYS[2]=lock key
-- ARGV[1]=now, ARGV[2]=member, ARGV[3]=window, ARGV[4]=max_fail, ARGV[5]=lockout_secs
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[3])
local max_fail = tonumber(ARGV[4])
local lockout = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('EXPIRE', KEYS[1], math.max(window, lockout) + 60)
local n = redis.call('ZCARD', KEYS[1])
if n >= max_fail then
  local until_ts = now + lockout
  redis.call('SET', KEYS[2], string.format('%.3f', until_ts), 'EX', lockout + 5)
  return {1, until_ts}
end
return {0, 0}
"""


class RedisLoginRateStore:
    """Shared rate-limit state for multi-worker deployments (Lua-atomic ops)."""

    def __init__(self, redis_url: str) -> None:
        import redis  # optional dependency

        self._r = redis.Redis.from_url(redis_url, decode_responses=True)
        self._r.ping()
        self._check = self._r.register_script(_REDIS_CHECK_SCRIPT)
        self._attempt = self._r.register_script(_REDIS_ATTEMPT_SCRIPT)
        self._failure = self._r.register_script(_REDIS_FAILURE_SCRIPT)

    def _ip_key(self, ip: str) -> str:
        return f"{_KEY_PREFIX}ip:{ip or 'unknown'}"

    def _fail_key(self, pair_key: str) -> str:
        return f"{_KEY_PREFIX}fail:{pair_key}"

    def _lock_key(self, pair_key: str) -> str:
        return f"{_KEY_PREFIX}lock:{pair_key}"

    def check_allowed(self, ip: str, email: str) -> None:
        now = time.time()
        pair_key = _pair_key(ip, email)
        code, until = self._check(
            keys=[self._ip_key(ip), self._lock_key(pair_key)],
            args=[now, WINDOW_SECONDS, MAX_ATTEMPTS_PER_IP],
        )
        code = int(code)
        if code == 1:
            _raise_lockout(float(until), now)
        if code == 2:
            _raise_ip_budget()

    def record_attempt(self, ip: str) -> None:
        now = time.time()
        member = f"{now:.6f}:{os.getpid()}:{threading.get_ident()}"
        self._attempt(
            keys=[self._ip_key(ip)],
            args=[now, member, WINDOW_SECONDS],
        )

    def record_failure(self, ip: str, email: str) -> None:
        now = time.time()
        pair_key = _pair_key(ip, email)
        member = f"{now:.6f}:{os.getpid()}:{threading.get_ident()}"
        self._failure(
            keys=[self._fail_key(pair_key), self._lock_key(pair_key)],
            args=[now, member, WINDOW_SECONDS, MAX_FAILURES_PER_EMAIL, LOCKOUT_SECONDS],
        )

    def clear_pair(self, ip: str, email: str) -> None:
        pair_key = _pair_key(ip, email)
        pipe = self._r.pipeline()
        pipe.delete(self._fail_key(pair_key))
        pipe.delete(self._lock_key(pair_key))
        pipe.execute()


_store: Optional[LoginRateStore] = None


def get_login_rate_store() -> LoginRateStore:
    global _store
    if _store is not None:
        return _store

    backend = os.getenv("RATE_LIMIT_BACKEND", "memory").strip().lower()
    if backend == "redis":
        url = os.getenv("REDIS_URL", "").strip()
        if not url:
            raise RuntimeError(
                "RATE_LIMIT_BACKEND=redis requires REDIS_URL (e.g. redis://redis:6379/0)."
            )
        try:
            _store = RedisLoginRateStore(url)
            logger.info("Login rate limiting backend: redis")
        except Exception as exc:
            raise RuntimeError(f"Failed to connect to Redis for rate limiting: {exc}") from exc
    else:
        if backend not in ("", "memory"):
            logger.warning("Unknown RATE_LIMIT_BACKEND=%r — using memory", backend)
        _store = MemoryLoginRateStore()
        logger.info("Login rate limiting backend: memory")
    return _store


def check_login_allowed(ip: str, email: str) -> None:
    """Raise 429 if this IP/email pair is currently rate-limited or locked out."""
    get_login_rate_store().check_allowed(ip, email)


def record_login_attempt(ip: str) -> None:
    """Count every login POST toward the per-IP budget (success or failure)."""
    get_login_rate_store().record_attempt(ip)


def record_login_failure(ip: str, email: str) -> None:
    """Count a failed password check toward the (ip, email) lockout."""
    get_login_rate_store().record_failure(ip, email)


def record_login_success(ip: str, email: str) -> None:
    get_login_rate_store().clear_pair(ip, email)

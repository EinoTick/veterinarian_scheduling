"""
Timezone policy for VetClinic Scheduler
---------------------------------------
* All timestamps are stored in the database as **UTC naive** ``datetime`` values
  (no tzinfo). Existing rows are treated as UTC.
* API inputs may be timezone-aware; they are converted to UTC before storage.
  Naive inputs are interpreted as UTC (explicit contract — do not send local
  wall times without an offset).
* Each clinic has an IANA ``timezone`` field (default ``UTC``) for future
  display / business-hours conversion. Scheduling math itself stays in UTC.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def utc_now() -> datetime:
    """UTC wall time stored without tzinfo (matches DB columns)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_naive(dt: datetime) -> datetime:
    """
    Normalize an incoming datetime to UTC-naive for storage/comparison.

    Aware values are converted to UTC. Naive values are assumed to already
    be UTC (caller contract).
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def as_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """Serialize a stored UTC-naive datetime as an ISO-8601 string with Z."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_iana_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown IANA timezone: {name}") from exc
    return name

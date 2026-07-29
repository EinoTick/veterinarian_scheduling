"""HTTP error helpers that never leak internal exception text to clients."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException

from logging_config import get_logger

logger = get_logger("vetclinic.errors")

GENERIC_INTERNAL = "An unexpected error occurred. Please try again."


def http_internal_error(
    exc: BaseException,
    *,
    action: str,
    **extra: Any,
) -> HTTPException:
    """Log the full exception server-side; return a generic 500 to the client."""
    logger.error(
        "action=%s failed: %s",
        action,
        exc,
        exc_info=exc,
        extra={
            "event": "internal_error",
            "action": action,
            **{k: v for k, v in extra.items() if v is not None},
        },
    )
    return HTTPException(status_code=500, detail=GENERIC_INTERNAL)


def log_event(event: str, *, level: int = 20, msg: Optional[str] = None, **fields: Any) -> None:
    """Emit a structured application event (info=20, warning=30, error=40)."""
    log = get_logger("vetclinic")
    log.log(
        level,
        msg or event,
        extra={"event": event, **{k: v for k, v in fields.items() if v is not None}},
    )

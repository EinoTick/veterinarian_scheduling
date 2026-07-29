"""
Structured logging setup for the VetClinic API.

Logs are emitted as one JSON object per line (stdout) so they can be collected
by Docker / CloudWatch / etc. without a third-party dependency.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Structured fields attached via logger.info("...", extra={...})
        for key in (
            "event",
            "user_id",
            "clinic_id",
            "appointment_id",
            "rule_id",
            "email",
            "ip",
            "action",
            "override_type",
            "status",
            "detail",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging(level: Optional[str] = None) -> None:
    log_level = (level or os.getenv("LOG_LEVEL", "INFO")).upper()
    root = logging.getLogger()
    # Replace only our JSON handler so we do not clobber handlers other
    # libraries may have attached (and so re-entry after Alembic is safe).
    for handler in list(root.handlers):
        if getattr(handler, "_vetclinic_json", False):
            root.removeHandler(handler)
            handler.close()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler._vetclinic_json = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(log_level)
    # Keep noisy libraries quieter unless explicitly debugging
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str = "vetclinic") -> logging.Logger:
    return logging.getLogger(name)

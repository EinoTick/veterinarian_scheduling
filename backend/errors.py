"""
Stable API error envelope helpers and FastAPI exception handlers.

Response shape (always):
  {
    "detail": <legacy FastAPI detail — string | list | object>,
    "error": {
      "code": "soft_stop" | "validation_error" | "internal_error" | ...,
      "message": "<human readable>",
      "details": <optional structured payload>
    }
  }
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from logging_config import get_logger

logger = get_logger("vetclinic.errors")

GENERIC_INTERNAL = "An unexpected error occurred. Please try again."


def error_body(
    *,
    code: str,
    message: str,
    detail: Any = None,
    details: Any = None,
) -> dict:
    if detail is None:
        detail = message
    return {
        "detail": detail,
        "error": {
            "code": code,
            "message": message,
            "details": details,
        },
    }


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


def _http_exception_payload(exc: HTTPException) -> dict:
    detail = exc.detail
    if isinstance(detail, dict) and detail.get("type"):
        code = str(detail["type"])
        message = (
            detail.get("message")
            or (detail["violations"][0]["description"] if detail.get("violations") else None)
            or code.replace("_", " ")
        )
        return error_body(code=code, message=message, detail=detail, details=detail)
    if isinstance(detail, list):
        return error_body(
            code="validation_error",
            message="Validation failed.",
            detail=detail,
            details=detail,
        )
    if isinstance(detail, str):
        return error_body(code="error", message=detail, detail=detail)
    return error_body(code="error", message=GENERIC_INTERNAL, detail=detail)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=_http_exception_payload(exc),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError):
        errors = exc.errors()
        return JSONResponse(
            status_code=422,
            content=error_body(
                code="validation_error",
                message="Validation failed.",
                detail=errors,
                details=errors,
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, exc: Exception):
        logger.error("unhandled: %s", exc, exc_info=exc, extra={"event": "unhandled_error"})
        return JSONResponse(
            status_code=500,
            content=error_body(
                code="internal_error",
                message=GENERIC_INTERNAL,
                detail=GENERIC_INTERNAL,
            ),
        )

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer
from jwt import PyJWTError
from sqlalchemy.orm import Session

from database import get_db
from models import RefreshToken, User
from password_policy import validate_password_strength  # noqa: F401 — re-export

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"

if SECRET_KEY in ("", "dev-secret-change-in-production", "change-this-to-a-long-random-secret-before-deploying"):
    # Never acceptable, in any environment — a known/placeholder secret lets anyone
    # forge valid session tokens. Refuse to start rather than run insecurely.
    raise RuntimeError(
        "JWT_SECRET_KEY is missing or still a placeholder. Set a long random secret "
        "(e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`) before starting the app."
    )

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# Short-lived access JWT; long-lived refresh token stored server-side (revocable).
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

ACCESS_COOKIE = "vc_access"
REFRESH_COOKIE = "vc_refresh"
# Scope both cookies to /api so they are not sent on unrelated frontend routes.
ACCESS_COOKIE_PATH = "/api"
REFRESH_COOKIE_PATH = "/api/auth"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()  # lax | strict | none

if IS_PRODUCTION and not COOKIE_SECURE:
    raise RuntimeError(
        "COOKIE_SECURE must be true when ENVIRONMENT=production (cookies would otherwise "
        "be sent over plaintext HTTP). Set COOKIE_SECURE=true behind HTTPS."
    )
elif not COOKIE_SECURE:
    logger.warning(
        "COOKIE_SECURE is false — fine for local HTTP development, but must be true in production."
    )

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials.",
    headers={"WWW-Authenticate": "Bearer"},
)

# Precomputed bcrypt hash used only to keep login timing closer when the email is unknown.
# Password material is irrelevant; do not use this as a real account hash.
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"timing-dummy-password", bcrypt.gensalt()).decode()


# ── Password hashing ──────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def run_dummy_password_check(plain: str) -> None:
    """Burn roughly the same CPU as a real password check (unknown-email path)."""
    verify_password(plain or "", _DUMMY_PASSWORD_HASH)


# ── JWT access tokens ─────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload["type"] = "access"
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "access":
        raise PyJWTError("Not an access token")
    return payload


# ── Refresh tokens (server-side, revocable) ───────────────────────────────────

def _hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(
    db: Session,
    user: User,
    *,
    user_agent: Optional[str] = None,
) -> str:
    raw = secrets.token_urlsafe(48)
    now = datetime.utcnow()
    row = RefreshToken(
        user_id=user.id,
        token_hash=_hash_refresh_token(raw),
        expires_at=now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        created_at=now,
        user_agent=(user_agent or "")[:512] or None,
    )
    db.add(row)
    db.flush()
    return raw


def revoke_refresh_token(row: RefreshToken) -> None:
    row.revoked_at = datetime.utcnow()


def revoke_all_refresh_tokens(db: Session, user_id: int) -> None:
    now = datetime.utcnow()
    (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .update({"revoked_at": now}, synchronize_session=False)
    )


# Keep a little history around after revocation/expiry (useful if we ever need
# to investigate a session) instead of deleting the instant a token goes stale.
_STALE_TOKEN_RETENTION_DAYS = 30


def purge_stale_refresh_tokens(db: Session, user_id: int) -> None:
    """
    Delete this user's own long-revoked/expired refresh token rows.

    Called opportunistically on login/refresh so the table doesn't grow
    without bound for active users. Scoped to a single user's rows so it's a
    small, cheap, no-new-infrastructure fix (not a full cleanup job).
    """
    cutoff = datetime.utcnow() - timedelta(days=_STALE_TOKEN_RETENTION_DAYS)
    (
        db.query(RefreshToken)
        .filter(
            RefreshToken.user_id == user_id,
            (
                (RefreshToken.revoked_at.isnot(None) & (RefreshToken.revoked_at < cutoff))
                | (RefreshToken.expires_at < cutoff)
            ),
        )
        .delete(synchronize_session=False)
    )


def consume_refresh_token(db: Session, raw: Optional[str]) -> Tuple[Optional[RefreshToken], str]:
    """
    Lock and consume a refresh token for rotation.

    Returns (row, status) where status is:
      - "ok": valid token, already marked revoked for rotation
      - "missing": no cookie / unknown hash
      - "expired": past expires_at
      - "reuse": presented a previously revoked token (possible theft) —
                 all of that user's refresh tokens have been revoked
    """
    if not raw:
        return None, "missing"

    token_hash = _hash_refresh_token(raw)
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == token_hash)
        .with_for_update()
        .first()
    )
    if not row:
        return None, "missing"

    if row.revoked_at is not None:
        # Refresh-token reuse → assume theft, kill the whole session family.
        revoke_all_refresh_tokens(db, row.user_id)
        return None, "reuse"

    if row.expires_at <= datetime.utcnow():
        revoke_refresh_token(row)
        return None, "expired"

    revoke_refresh_token(row)
    return row, "ok"


def lookup_refresh_token(db: Session, raw: str) -> Optional[RefreshToken]:
    """Non-locking lookup of an active refresh token (e.g. logout)."""
    if not raw:
        return None
    return (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == _hash_refresh_token(raw),
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.utcnow(),
        )
        .first()
    )


# ── Cookies ───────────────────────────────────────────────────────────────────

def _cookie_kwargs(*, path: str, max_age: int) -> dict:
    samesite = COOKIE_SAMESITE if COOKIE_SAMESITE in ("lax", "strict", "none") else "lax"
    # Browsers require Secure when SameSite=None
    secure = True if samesite == "none" else COOKIE_SECURE
    return {
        "httponly": True,
        "secure": secure,
        "samesite": samesite,
        "path": path,
        "max_age": max_age,
    }


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        **_cookie_kwargs(
            path=ACCESS_COOKIE_PATH,
            max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        ),
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        **_cookie_kwargs(
            path=REFRESH_COOKIE_PATH,
            max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        ),
    )


def clear_auth_cookies(response: Response) -> None:
    samesite = COOKIE_SAMESITE if COOKIE_SAMESITE in ("lax", "strict", "none") else "lax"
    secure = True if samesite == "none" else COOKIE_SECURE
    # Delete both current and legacy paths so upgrades clear old cookies.
    for path in {ACCESS_COOKIE_PATH, "/", "/api"}:
        response.delete_cookie(ACCESS_COOKIE, path=path, samesite=samesite, secure=secure)
    for path in {REFRESH_COOKIE_PATH, "/api/auth", "/"}:
        response.delete_cookie(REFRESH_COOKIE, path=path, samesite=samesite, secure=secure)


def issue_session(
    response: Response,
    db: Session,
    user: User,
    *,
    user_agent: Optional[str] = None,
) -> Tuple[str, str]:
    access = create_access_token({
        "sub": str(user.id),
        "system_role": user.system_role,
        "clinic_id": user.clinic_id,
    })
    refresh = issue_refresh_token(db, user, user_agent=user_agent)
    purge_stale_refresh_tokens(db, user.id)
    set_auth_cookies(response, access, refresh)
    return access, refresh


# ── Dependencies ──────────────────────────────────────────────────────────────

def get_current_user(
    bearer: Optional[str] = Depends(oauth2_scheme),
    access_cookie: Optional[str] = Cookie(default=None, alias=ACCESS_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    token = access_cookie or bearer
    if not token:
        raise _CREDENTIALS_EXC
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            raise _CREDENTIALS_EXC
    except PyJWTError:
        raise _CREDENTIALS_EXC

    user = db.get(User, int(user_id))
    if not user or not user.is_active:
        raise _CREDENTIALS_EXC
    return user


def require_clinic_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.system_role not in ("CLINIC_ADMIN", "SYSTEM_ADMIN"):
        raise HTTPException(status_code=403, detail="Clinic admin access required.")
    return current_user


def require_system_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.system_role != "SYSTEM_ADMIN":
        raise HTTPException(status_code=403, detail="System admin access required.")
    return current_user


# ── Tenant scoping helper ─────────────────────────────────────────────────────

def clinic_filter(query, model, current_user: User):
    """
    Apply clinic_id scoping to a query.
    SYSTEM_ADMIN sees all rows; everyone else sees only their clinic.
    Usage:  q = clinic_filter(db.query(Appointment), Appointment, current_user)
    """
    if current_user.system_role != "SYSTEM_ADMIN":
        query = query.filter(model.clinic_id == current_user.clinic_id)
    return query

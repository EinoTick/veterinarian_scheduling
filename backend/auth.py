import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from models import User

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # 8-hour sessions

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ── Dependencies ──────────────────────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    user = db.get(User, int(user_id))
    if not user or not user.is_active:
        raise credentials_exc
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

from datetime import datetime, timedelta, timezone
from typing import List, Optional
import os
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload

from auth import (
    IS_PRODUCTION,
    REFRESH_COOKIE,
    clear_auth_cookies,
    clinic_filter,
    consume_refresh_token,
    get_current_user,
    hash_password,
    issue_session,
    lookup_refresh_token,
    require_clinic_admin,
    require_system_admin,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    run_dummy_password_check,
    verify_password,
)
from database import SessionLocal, engine, get_db
from login_guard import (
    check_login_allowed,
    record_login_attempt,
    record_login_failure,
    record_login_success,
)
from models import (
    Appointment, AppointmentAllocation, Base, Client, Clinic, OverrideLog,
    Patient, Resource, Role, Rule, Service, User,
)
from schemas import (
    APPOINTMENT_STATUSES, AppointmentCreate, AppointmentListOut, AppointmentOut, AppointmentUpdate,
    AppointmentValidateOut, AllocationOut, AuthSessionOut, ClinicOut, PasswordChange, ResourceOut,
    RoleOut, RuleCreate, RuleOut, RuleUpdate, ScheduleEventOut, ServiceOut, SoftStopResponse,
    UserCreate, UserOut, ViolationDetail,
)
from catalog_routes import router as catalog_router
from errors import http_internal_error, log_event
from logging_config import setup_logging
from timeutil import as_utc_iso, to_utc_naive, utc_now

app = FastAPI(
    title="VetClinic Scheduler",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

_cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

app.include_router(catalog_router)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """Liveness/readiness probe — no auth, cheap DB round-trip."""
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


# Schema is owned exclusively by Alembic (see alembic/versions/).
# Do not call Base.metadata.create_all here — greenfield DBs are built by
# ``alembic upgrade head`` (also invoked from on_startup).


# ── Seed ──────────────────────────────────────────────────────────────────────

def seed_db(db: Session):
    if IS_PRODUCTION:
        return
    if db.query(Clinic).count():
        return

    log_event(
        "demo_data_seeded",
        level=30,
        msg="No clinics found — seeding demo clinic, users, and rules (ENVIRONMENT != production).",
    )

    # Demo clinic
    clinic = Clinic(name="Riverside Animal Hospital", timezone="UTC")
    db.add(clinic)
    db.flush()

    # Clinical roles (global catalog — clinic_id NULL)
    vet = Role(name="Veterinarian", can_prescribe=True, clinic_id=None)
    tech = Role(name="Licensed Tech", can_prescribe=False, clinic_id=None)
    assistant = Role(name="Assistant", can_prescribe=False, clinic_id=None)
    db.add_all([vet, tech, assistant])
    db.flush()

    # Clinic-specific example role
    groomer = Role(name="Groomer", can_prescribe=False, clinic_id=clinic.id)
    db.add(groomer)
    db.flush()

    # System users
    db.add_all([
        User(
            name="System Administrator",
            email="admin@vetclinic.com",
            hashed_password=hash_password("admin1234"),
            system_role="SYSTEM_ADMIN",
            clinic_id=None,
            role_id=None,
            is_active=True,
        ),
        User(
            name="Clinic Manager",
            email="manager@riverside.com",
            hashed_password=hash_password("manager1234"),
            system_role="CLINIC_ADMIN",
            clinic_id=clinic.id,
            role_id=None,
            is_active=True,
        ),
        User(
            name="Dr. Sarah Chen",
            email="sarah.chen@riverside.com",
            hashed_password=hash_password("password123"),
            system_role="USER",
            clinic_id=clinic.id,
            role_id=vet.id,
            is_active=True,
        ),
        User(
            name="Dr. Marcus Webb",
            email="marcus.webb@riverside.com",
            hashed_password=hash_password("password123"),
            system_role="USER",
            clinic_id=clinic.id,
            role_id=vet.id,
            is_active=True,
        ),
        User(
            name="Jamie Torres",
            email="jamie.torres@riverside.com",
            hashed_password=hash_password("password123"),
            system_role="USER",
            clinic_id=clinic.id,
            role_id=tech.id,
            is_active=True,
        ),
        User(
            name="Riley Park",
            email="riley.park@riverside.com",
            hashed_password=hash_password("password123"),
            system_role="USER",
            clinic_id=clinic.id,
            role_id=tech.id,
            is_active=True,
        ),
    ])

    dental_suite = Resource(clinic_id=clinic.id, name="Dental Suite A", resource_type="room", category="dental_suite")
    surgery = Resource(clinic_id=clinic.id, name="Surgery Suite 1", resource_type="room", category="surgery_suite")
    xray = Resource(clinic_id=clinic.id, name="X-Ray Unit", resource_type="equipment", category="imaging")
    exam1 = Resource(clinic_id=clinic.id, name="Exam Room 1", resource_type="room", category="exam_room")
    exam2 = Resource(clinic_id=clinic.id, name="Exam Room 2", resource_type="room", category="exam_room")
    db.add_all([dental_suite, surgery, xray, exam1, exam2])
    db.flush()

    dental = Service(clinic_id=clinic.id, name="Dental Cleaning", default_duration_minutes=90)
    surgery_svc = Service(clinic_id=clinic.id, name="Soft Tissue Surgery", default_duration_minutes=120)
    wellness = Service(clinic_id=clinic.id, name="Wellness Exam", default_duration_minutes=30)
    xray_svc = Service(clinic_id=clinic.id, name="Radiograph (X-Ray)", default_duration_minutes=20)
    db.add_all([dental, surgery_svc, wellness, xray_svc])
    db.flush()

    db.add_all([
        Rule(clinic_id=clinic.id, service_id=dental.id, required_role_id=tech.id,
             is_hard_stop=True, description="Dental Cleaning requires a Licensed Tech."),
        Rule(clinic_id=clinic.id, service_id=dental.id, required_resource_id=dental_suite.id,
             is_hard_stop=True, description="Dental Cleaning must be performed in the Dental Suite."),
        Rule(clinic_id=clinic.id, service_id=surgery_svc.id, required_role_id=vet.id,
             is_hard_stop=True, description="Surgery requires a Veterinarian."),
        Rule(clinic_id=clinic.id, service_id=surgery_svc.id, required_resource_id=surgery.id,
             is_hard_stop=True, description="Surgery must be performed in a Surgery Suite."),
        Rule(clinic_id=clinic.id, service_id=xray_svc.id, required_resource_id=xray.id,
             is_hard_stop=False, description="Radiograph should use the dedicated X-Ray Unit (soft warning)."),
        # Example: wellness needs any exam room (category match)
        Rule(clinic_id=clinic.id, service_id=wellness.id, required_resource_category="exam_room",
             is_hard_stop=True, description="Wellness Exam requires an exam room."),
        # Example: after 6pm surgery needs a vet present in-room for the first 30 minutes
        Rule(
            clinic_id=clinic.id, service_id=surgery_svc.id, required_role_id=vet.id,
            min_quantity=1, presence_type="IN_ROOM",
            start_offset_minutes=0, duration_minutes=30,
            active_start_time="18:00",
            is_hard_stop=False,
            description="After 6pm, a Veterinarian should be in-room for the first 30 minutes of surgery.",
        ),
    ])

    db.commit()


# Arbitrary fixed key for the startup-migration advisory lock, scoped to
# this app (any bigint works — it just needs to be consistent across every
# instance so they contend for the same lock).
_MIGRATION_LOCK_KEY = 927341001


def run_alembic_migrations() -> None:
    """
    Apply versioned Alembic migrations — the only schema ownership path.

    Greenfield databases are created entirely by revisions (starting at
    ``000_schema_baseline``). There is no SQLAlchemy ``create_all`` fallback.

    Held under a Postgres advisory lock so that multiple app instances
    starting concurrently (rolling deploy, multiple workers/replicas) don't
    race the same upgrade invocation: the second instance blocks here until
    the first finishes instead of both running ``command.upgrade`` at once.
    """
    from pathlib import Path
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parent / "alembic.ini"))
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
        try:
            command.upgrade(cfg, "head")
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK_KEY})


@app.on_event("startup")
def on_startup():
    setup_logging()
    log_event("app_startup", msg="VetClinic API starting")
    try:
        run_alembic_migrations()
    except Exception as exc:
        log_event(
            "alembic_upgrade_failed",
            level=40,
            msg=f"Alembic upgrade failed: {exc}",
        )
        raise
    # Re-assert app logging in case any dependency touched root handlers.
    setup_logging()
    with SessionLocal() as db:
        seed_db(db)


# ── Auth endpoints ────────────────────────────────────────────────────────────

_TRUST_PROXY = os.getenv("TRUST_PROXY", "false").lower() in ("1", "true", "yes")


def _client_ip(request: Request) -> str:
    # Only honor X-Forwarded-For when explicitly behind a trusted reverse proxy.
    # Otherwise clients can spoof the header and bypass per-IP rate limits.
    if _TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def _mask_email(email: str) -> str:
    """Redact an email for logs: keep enough to correlate, not enough to read."""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    visible = local[:1] or "*"
    return f"{visible}***@{domain}"


@app.post("/api/auth/token", response_model=AuthSessionOut)
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    ip = _client_ip(request)
    email = form.username or ""
    check_login_allowed(ip, email)
    record_login_attempt(ip)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        run_dummy_password_check(form.password)
        record_login_failure(ip, email)
        log_event("login_failed", level=30, email=_mask_email(email), ip=ip, detail="unknown_email")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(form.password, user.hashed_password):
        record_login_failure(ip, email)
        log_event("login_failed", level=30, email=_mask_email(email), ip=ip, user_id=user.id, detail="bad_password")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        # Valid credentials, disabled account — same client message, no lockout bump.
        log_event("login_failed", level=30, email=_mask_email(email), ip=ip, user_id=user.id, detail="inactive")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    record_login_success(ip, email)
    log_event("login_success", user_id=user.id, email=_mask_email(email), ip=ip, clinic_id=user.clinic_id)
    issue_session(
        response,
        db,
        user,
        user_agent=request.headers.get("user-agent"),
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        clear_auth_cookies(response)
        raise http_internal_error(exc, action="auth_session")
    return AuthSessionOut(authenticated=True)


@app.post("/api/auth/refresh", response_model=AuthSessionOut)
def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    raw = request.cookies.get(REFRESH_COOKIE)
    row, consume_status = consume_refresh_token(db, raw)
    if consume_status != "ok" or row is None:
        try:
            db.commit()  # persist reuse-triggered mass revoke, if any
        except Exception as exc:
            db.rollback()
            log_event("auth_refresh_commit_failed", level=40, msg=str(exc), detail=consume_status)
        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            log_event("auth_refresh_commit_failed", level=40, msg=str(exc), detail="inactive_user")
        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    issue_session(
        response,
        db,
        user,
        user_agent=request.headers.get("user-agent"),
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        clear_auth_cookies(response)
        raise http_internal_error(exc, action="auth_session")
    return AuthSessionOut(authenticated=True)


@app.post("/api/auth/logout", response_model=AuthSessionOut)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        row = lookup_refresh_token(db, raw)
        if row:
            revoke_refresh_token(row)
            try:
                db.commit()
            except Exception as exc:
                db.rollback()
                log_event("auth_logout_commit_failed", level=40, msg=str(exc))
    clear_auth_cookies(response)
    return AuthSessionOut(authenticated=False)


@app.get("/api/auth/me", response_model=UserOut)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    out = UserOut.model_validate(current_user)
    if current_user.clinic_id:
        clinic = db.get(Clinic, current_user.clinic_id)
        if clinic:
            out = out.model_copy(update={"clinic_timezone": clinic.timezone or "UTC"})
    return out


@app.post("/api/auth/change-password")
def change_password(
    response: Response,
    payload: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(400, "Current password is incorrect.")
    try:
        current_user.hashed_password = hash_password(payload.new_password)
        # Invalidate every refresh session, then mint a fresh one for this browser.
        revoke_all_refresh_tokens(db, current_user.id)
        issue_session(response, db, current_user)
        db.commit()
    except Exception as exc:
        db.rollback()
        clear_auth_cookies(response)
        raise http_internal_error(exc, action="auth_session")
    return {"ok": True}


# ── User management (CLINIC_ADMIN+) ──────────────────────────────────────────

@app.get("/api/users", response_model=List[UserOut])
def list_users(
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    q = db.query(User)
    if not include_inactive:
        q = q.filter(User.is_active == True)
    return clinic_filter(q, User, current_user).all()


@app.get("/api/staff", response_model=List[UserOut])
def list_staff(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Clinic-scoped active staff list for booking allocations and override authorizers.
    Available to any authenticated user (unlike /api/users which is admin-only).
    """
    q = db.query(User).filter(User.is_active == True, User.system_role != "SYSTEM_ADMIN")
    if current_user.system_role == "SYSTEM_ADMIN":
        # System admins see everyone except other system admins unless filtered by clinic in UI
        return q.order_by(User.name).all()
    return q.filter(User.clinic_id == current_user.clinic_id).order_by(User.name).all()


@app.post("/api/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(400, "Email already registered.")

    if current_user.system_role != "SYSTEM_ADMIN" and payload.system_role == "SYSTEM_ADMIN":
        raise HTTPException(403, "Cannot grant system administrator role.")

    target_clinic_id = (
        payload.clinic_id if current_user.system_role == "SYSTEM_ADMIN"
        else current_user.clinic_id
    )
    if payload.system_role != "SYSTEM_ADMIN" and target_clinic_id is None:
        raise HTTPException(400, "clinic_id is required for non-system-admin users.")

    if payload.role_id:
        role = db.get(Role, payload.role_id)
        if not role or not role.is_active:
            raise HTTPException(400, "Clinical role not found or inactive.")
        if role.clinic_id is not None and role.clinic_id != target_clinic_id:
            raise HTTPException(400, "Clinical role does not belong to the target clinic.")

    now = utc_now()
    try:
        user = User(
            name=payload.name,
            email=payload.email,
            hashed_password=hash_password(payload.password),
            system_role=payload.system_role,
            role_id=payload.role_id,
            clinic_id=target_clinic_id,
            is_active=True,
            created_at=now,
            updated_at=now,
            created_by_user_id=current_user.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="db_write")

    return user


# ── Reference data (auth-protected, clinic-scoped) ────────────────────────────

@app.get("/api/clinics", response_model=List[ClinicOut])
def list_clinics(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # SYSTEM_ADMIN operates across clinics; everyone else only ever needs
    # (and should only ever see) their own clinic's record.
    if current_user.system_role == "SYSTEM_ADMIN":
        return db.query(Clinic).all()
    return db.query(Clinic).filter(Clinic.id == current_user.clinic_id).all()


@app.get("/api/rules", response_model=List[RuleOut])
def list_rules(
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = clinic_filter(db.query(Rule), Rule, current_user)
    if not include_inactive:
        q = q.filter(Rule.is_active == True)
    return q.all()


@app.post("/api/rules", response_model=RuleOut, status_code=201)
def create_rule(
    payload: RuleCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    target_clinic_id = _resolve_rule_clinic_id(payload.clinic_id, current_user)
    _validate_rule_refs(payload, target_clinic_id, db)

    try:
        rule_data = payload.model_dump(exclude={"clinic_id"})
        rule = Rule(**rule_data, clinic_id=target_clinic_id)
        db.add(rule)
        db.commit()
        db.refresh(rule)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="db_write")

    return rule


@app.patch("/api/rules/{rule_id}", response_model=RuleOut)
def update_rule(
    rule_id: int,
    payload: RuleUpdate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    rule = db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and rule.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)

    clear_map = {
        "clear_required_role_id": "required_role_id",
        "clear_alternative_role_ids": "alternative_role_ids",
        "clear_required_resource_id": "required_resource_id",
        "clear_required_resource_type": "required_resource_type",
        "clear_required_resource_category": "required_resource_category",
        "clear_duration_minutes": "duration_minutes",
        "clear_presence_type": "presence_type",
        "clear_active_weekdays": "active_weekdays",
        "clear_active_start_time": "active_start_time",
        "clear_active_end_time": "active_end_time",
    }
    for flag, field in clear_map.items():
        if data.pop(flag, False):
            setattr(rule, field, None)

    for key, value in data.items():
        if key.startswith("clear_"):
            continue
        setattr(rule, key, value)

    if not _rule_has_constraint(rule):
        raise HTTPException(
            400,
            "A rule must constrain at least a role, resource, resource type, or category.",
        )

    # Re-validate refs against the rule's clinic via a temporary RuleCreate-shaped object
    try:
        probe = RuleCreate(
            service_id=rule.service_id,
            required_role_id=rule.required_role_id,
            alternative_role_ids=rule.alternative_role_ids,
            required_resource_id=rule.required_resource_id,
            required_resource_type=rule.required_resource_type,
            required_resource_category=rule.required_resource_category,
            min_quantity=rule.min_quantity or 1,
            is_hard_stop=bool(rule.is_hard_stop),
            description=rule.description,
            duration_minutes=rule.duration_minutes,
            start_offset_minutes=rule.start_offset_minutes or 0,
            presence_type=rule.presence_type,
            active_weekdays=rule.active_weekdays,
            active_start_time=rule.active_start_time,
            active_end_time=rule.active_end_time,
        )
    except Exception as exc:
        raise HTTPException(400, detail="Invalid rule update payload.") from exc

    _validate_rule_refs(probe, rule.clinic_id, db)

    try:
        db.commit()
        db.refresh(rule)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="db_write")
    return rule


@app.delete("/api/rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    hard: bool = Query(False, description="Permanently delete instead of deactivating"),
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    rule = db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and rule.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    try:
        if hard:
            db.delete(rule)
        else:
            rule.is_active = False
        db.commit()
    except Exception as exc:
        db.rollback()
        if hard:
            raise HTTPException(
                400,
                "Cannot permanently delete this rule (it may be referenced by override logs). "
                "Deactivate it instead, or pass hard=false.",
            ) from exc
        raise http_internal_error(exc, action="db_write")
    return Response(status_code=204)


def _resolve_rule_clinic_id(payload_clinic_id, current_user: User) -> int:
    if current_user.system_role == "SYSTEM_ADMIN":
        if not payload_clinic_id:
            raise HTTPException(400, "System administrators must supply a clinic_id.")
        return payload_clinic_id
    return current_user.clinic_id


def _validate_rule_refs(payload: RuleCreate, target_clinic_id: int, db: Session):
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found.")
    if service.clinic_id != target_clinic_id:
        raise HTTPException(400, "Service does not belong to the target clinic.")

    if payload.required_role_id:
        role = db.get(Role, payload.required_role_id)
        if not role:
            raise HTTPException(404, "Role not found.")
        if role.clinic_id is not None and role.clinic_id != target_clinic_id:
            raise HTTPException(400, "Role does not belong to the target clinic.")
    if payload.alternative_role_ids:
        for rid in payload.alternative_role_ids:
            alt_role = db.get(Role, rid)
            if not alt_role:
                raise HTTPException(404, f"Alternative role #{rid} not found.")
            if alt_role.clinic_id is not None and alt_role.clinic_id != target_clinic_id:
                raise HTTPException(400, f"Alternative role #{rid} does not belong to the target clinic.")

    if payload.required_resource_id and (
        payload.required_resource_type or payload.required_resource_category
    ):
        raise HTTPException(
            400,
            "Use either a specific resource_id or a resource type/category, not both.",
        )

    if payload.required_resource_id:
        resource = db.get(Resource, payload.required_resource_id)
        if not resource:
            raise HTTPException(404, "Resource not found.")
        if resource.clinic_id != target_clinic_id:
            raise HTTPException(400, "Resource does not belong to the target clinic.")

    if payload.presence_type and payload.presence_type not in (
        "IN_ROOM", "IN_BUILDING", "REMOTE",
    ):
        raise HTTPException(400, "presence_type must be IN_ROOM, IN_BUILDING, or REMOTE.")

    if payload.active_start_time and not _valid_hhmm(payload.active_start_time):
        raise HTTPException(400, "active_start_time must be HH:MM.")
    if payload.active_end_time and not _valid_hhmm(payload.active_end_time):
        raise HTTPException(400, "active_end_time must be HH:MM.")
    if (
        payload.active_start_time
        and payload.active_end_time
        and payload.active_start_time == payload.active_end_time
    ):
        # Ambiguous: could mean "all day" or "never". active_start_time <
        # active_end_time is a same-day window; active_start_time > end is
        # treated as an overnight window (see _rule_applies_at) — but equal
        # values don't have a sensible interpretation, so reject explicitly
        # instead of silently producing a dead or always-on rule.
        raise HTTPException(
            400,
            "active_start_time and active_end_time cannot be equal. "
            "Leave both blank for an all-day rule, or set a real range "
            "(start > end is treated as an overnight window).",
        )


def _valid_hhmm(value: str) -> bool:
    if len(value) != 5 or value[2] != ":":
        return False
    try:
        h, m = int(value[:2]), int(value[3:])
        return 0 <= h <= 23 and 0 <= m <= 59
    except ValueError:
        return False


def _rule_has_constraint(rule: Rule) -> bool:
    return bool(
        rule.required_role_id
        or (rule.alternative_role_ids and len(rule.alternative_role_ids) > 0)
        or rule.required_resource_id
        or rule.required_resource_type
        or rule.required_resource_category
    )


# ── Rules engine ──────────────────────────────────────────────────────────────

def _accepted_role_ids(rule: Rule) -> set:
    roles = set()
    if rule.required_role_id is not None:
        roles.add(rule.required_role_id)
    if rule.alternative_role_ids:
        roles.update(rule.alternative_role_ids)
    return roles


def _resolve_clinic_timezone(clinic_id: Optional[int], db: Session) -> ZoneInfo:
    clinic = db.get(Clinic, clinic_id) if clinic_id is not None else None
    tz_name = clinic.timezone if clinic and clinic.timezone else "UTC"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        # Bad/unknown IANA name shouldn't take down rule evaluation — fall back to UTC.
        return ZoneInfo("UTC")


def _to_clinic_local(appt_start_utc: datetime, clinic_id: Optional[int], db: Session) -> datetime:
    """Convert a UTC-naive appointment start into the clinic's local wall time (naive)."""
    tz = _resolve_clinic_timezone(clinic_id, db)
    aware_utc = appt_start_utc.replace(tzinfo=timezone.utc)
    return aware_utc.astimezone(tz).replace(tzinfo=None)


def _rule_applies_at(rule: Rule, appt_start_local: datetime) -> bool:
    """
    Return False when the appointment falls outside the rule's day/time window.

    `appt_start_local` must already be converted to the clinic's local time
    (see `_to_clinic_local`) — comparing against the rule's HH:MM/weekday
    fields in UTC would fire day/time-scoped rules at the wrong wall-clock
    hour for any clinic not physically in UTC.
    """
    if rule.active_weekdays is not None and len(rule.active_weekdays) > 0:
        if appt_start_local.weekday() not in rule.active_weekdays:
            return False

    start, end = rule.active_start_time, rule.active_end_time
    if not start and not end:
        return True

    appt_hm = appt_start_local.strftime("%H:%M")
    if start and end:
        if start <= end:
            return start <= appt_hm < end
        # Overnight window (e.g. 22:00-02:00): wraps past midnight.
        return appt_hm >= start or appt_hm < end
    if start:
        return appt_hm >= start
    return appt_hm < end


def _allocation_covers_rule_window(alloc, rule: Rule, service_duration: int) -> bool:
    """
    If the rule specifies a timing window (offset/duration), the allocation must
    fully cover that window. Otherwise any allocation that matches is enough.
    """
    has_timing = (
        (rule.duration_minutes is not None)
        or (rule.start_offset_minutes and rule.start_offset_minutes > 0)
    )
    if not has_timing:
        return True

    rule_start = rule.start_offset_minutes or 0
    rule_end = rule_start + (rule.duration_minutes if rule.duration_minutes is not None else service_duration)

    alloc_start = getattr(alloc, "start_offset_minutes", None)
    if alloc_start is None:
        # ORM AppointmentAllocation uses absolute times; for transient AllocationIn-like
        # objects we also accept start_offset_minutes.
        alloc_start = 0
    alloc_duration = getattr(alloc, "duration_minutes", None)
    if alloc_duration is None:
        alloc_duration = service_duration
    alloc_end = alloc_start + alloc_duration

    return alloc_start <= rule_start and alloc_end >= rule_end


def _allocation_matches_role(alloc, accepted_roles: set, db: Session) -> bool:
    uid = getattr(alloc, "user_id", None)
    if not uid or not accepted_roles:
        return False
    user = db.get(User, uid)
    return bool(user and user.role_id in accepted_roles)


def _allocation_matches_resource(alloc, rule: Rule, db: Session) -> bool:
    rid = getattr(alloc, "resource_id", None)
    if not rid:
        return False

    # Specific resource always wins — type/category must not also be set (enforced on write)
    if rule.required_resource_id is not None:
        return rid == rule.required_resource_id

    resource = db.get(Resource, rid)
    if not resource:
        return False
    if rule.required_resource_category and resource.category != rule.required_resource_category:
        return False
    if rule.required_resource_type and resource.resource_type != rule.required_resource_type:
        return False
    return bool(rule.required_resource_category or rule.required_resource_type)


def _allocation_presence_ok(alloc, rule: Rule) -> bool:
    if not rule.presence_type:
        return True
    if not getattr(alloc, "user_id", None):
        return True
    return getattr(alloc, "presence_type", None) == rule.presence_type


def _normalize_alloc_for_eval(alloc, service_duration: int):
    """Attach offset/duration onto a plain object usable by coverage checks."""
    class _Norm:
        pass
    n = _Norm()
    n.user_id = getattr(alloc, "user_id", None)
    n.resource_id = getattr(alloc, "resource_id", None)
    n.presence_type = getattr(alloc, "presence_type", None)
    n.start_offset_minutes = getattr(alloc, "start_offset_minutes", None) or 0
    dur = getattr(alloc, "duration_minutes", None)
    n.duration_minutes = dur if dur is not None else service_duration
    return n


def _evaluate_rules(service_id, allocations, db, appt_start=None, service_duration=None):
    """
    Evaluate active rules for a service against the proposed allocations.

    Supports:
    - role OR alternative roles, with min_quantity
    - specific resource / resource type / resource category
    - timing window coverage (start_offset + duration)
    - required presence_type for staff
    - day/time scoping (skipped when appt_start is None)

    min_quantity applies to the role constraint when one is present; otherwise to the
    resource constraint. When both role and resource are required, roles need
    min_quantity matches and the resource side needs at least one match.
    """
    rules = (
        db.query(Rule)
        .filter(Rule.service_id == service_id, Rule.is_active == True)
        .all()
    )
    if not rules:
        return []

    service = None
    if service_duration is None or appt_start is not None:
        service = db.get(Service, service_id)
    if service_duration is None:
        service_duration = service.default_duration_minutes if service else 30

    appt_start_local = None
    if appt_start is not None:
        appt_start_local = _to_clinic_local(appt_start, service.clinic_id if service else None, db)

    norms = [_normalize_alloc_for_eval(a, service_duration) for a in allocations]
    violations = []

    for rule in rules:
        if appt_start_local is not None and not _rule_applies_at(rule, appt_start_local):
            continue

        qty = rule.min_quantity or 1
        accepted_roles = _accepted_role_ids(rule)
        has_role_constraint = bool(accepted_roles)
        has_resource_constraint = bool(
            rule.required_resource_id
            or rule.required_resource_type
            or rule.required_resource_category
        )

        role_ok = True
        resource_ok = True

        if has_role_constraint:
            matching_user_ids = {
                a.user_id for a in norms
                if a.user_id
                and _allocation_matches_role(a, accepted_roles, db)
                and _allocation_covers_rule_window(a, rule, service_duration)
                and _allocation_presence_ok(a, rule)
            }
            role_ok = len(matching_user_ids) >= qty

        if has_resource_constraint:
            # Quantity applies to resources only when there is no role constraint
            resource_qty = 1 if has_role_constraint else qty
            matching_resource_ids = {
                a.resource_id for a in norms
                if a.resource_id
                and _allocation_matches_resource(a, rule, db)
                and _allocation_covers_rule_window(a, rule, service_duration)
            }
            resource_ok = len(matching_resource_ids) >= resource_qty

        if not (role_ok and resource_ok):
            violations.append(ViolationDetail(
                rule_id=rule.id,
                description=rule.description,
                is_hard_stop=rule.is_hard_stop,
            ))

    return violations


def _lock_allocation_targets(allocations, db: Session) -> None:
    """
    Serialize concurrent bookings for the same user/resource.

    The naive approach — lock whatever AppointmentAllocation rows currently
    overlap the new window — locks nothing when the target slot is empty
    (the common case), so two concurrent requests booking the same brand-new
    slot for the same vet/room can both pass the double-booking check and
    both commit. Locking the User/Resource master row instead works because
    that row always exists, so `SELECT ... FOR UPDATE` genuinely serializes
    the check-then-insert for that person/resource across concurrent
    transactions. IDs are locked in a fixed (sorted) order across all callers
    to avoid lock-ordering deadlocks between overlapping bookings.
    """
    user_ids = sorted({a.user_id for a in allocations if a.user_id})
    resource_ids = sorted({a.resource_id for a in allocations if a.resource_id})
    if user_ids:
        db.query(User.id).filter(User.id.in_(user_ids)).order_by(User.id).with_for_update().all()
    if resource_ids:
        db.query(Resource.id).filter(Resource.id.in_(resource_ids)).order_by(Resource.id).with_for_update().all()


def _check_double_booking(allocations_in, appt_start, service_duration, db, exclude_appointment_id=None):
    conflicts = []
    for alloc_data in allocations_in:
        offset = alloc_data.start_offset_minutes or 0
        duration = alloc_data.duration_minutes or service_duration
        alloc_start = appt_start + timedelta(minutes=offset)
        alloc_end = alloc_start + timedelta(minutes=duration)

        base = (
            db.query(AppointmentAllocation)
            .join(Appointment)
            .filter(
                AppointmentAllocation.start_time.isnot(None),
                AppointmentAllocation.start_time < alloc_end,
                AppointmentAllocation.end_time > alloc_start,
                Appointment.status.in_(["scheduled", "completed", "no_show"]),
            )
        )
        if exclude_appointment_id is not None:
            base = base.filter(AppointmentAllocation.appointment_id != exclude_appointment_id)

        if alloc_data.user_id:
            overlap = base.filter(AppointmentAllocation.user_id == alloc_data.user_id).first()
            if overlap:
                user = db.get(User, alloc_data.user_id)
                conflicts.append({
                    "entity": user.name if user else f"User #{alloc_data.user_id}",
                    "entity_type": "user",
                    "appointment_id": overlap.appointment_id,
                    "start_time": as_utc_iso(overlap.start_time),
                    "end_time": as_utc_iso(overlap.end_time),
                })

        if alloc_data.resource_id:
            overlap = base.filter(AppointmentAllocation.resource_id == alloc_data.resource_id).first()
            if overlap:
                resource = db.get(Resource, alloc_data.resource_id)
                conflicts.append({
                    "entity": resource.name if resource else f"Resource #{alloc_data.resource_id}",
                    "entity_type": "resource",
                    "appointment_id": overlap.appointment_id,
                    "start_time": as_utc_iso(overlap.start_time),
                    "end_time": as_utc_iso(overlap.end_time),
                })

    return conflicts


def _resolve_appointment_clinic_id(payload: AppointmentCreate, current_user: User) -> int:
    if current_user.system_role == "SYSTEM_ADMIN":
        if not payload.clinic_id:
            raise HTTPException(400, "System administrators must provide a clinic_id.")
        return payload.clinic_id
    clinic_id = current_user.clinic_id
    if clinic_id is None:
        raise HTTPException(400, "User is not associated with a clinic.")
    return clinic_id


def _validate_appointment_inputs(
    payload: AppointmentCreate,
    clinic_id: int,
    db: Session,
    *,
    exclude_appointment_id: Optional[int] = None,
    enforce_future: bool = True,
):
    """
    Shared validation for create + preview. Returns
    (service, hard_violations, soft_violations, conflicts).
    Raises HTTPException for hard input errors (missing service, bad tenant, bad offsets).

    `enforce_future` guards the past-date check. Callers pass False when
    `payload.start_time` isn't actually being changed (e.g. editing an
    existing appointment's notes without rescheduling it) so that touching
    an appointment whose time has already passed doesn't become impossible.
    """
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found.")
    if service.clinic_id != clinic_id:
        raise HTTPException(400, "Service does not belong to the target clinic.")
    if not service.is_active:
        raise HTTPException(400, "Service is inactive and cannot be booked.")

    if not payload.allocations:
        raise HTTPException(400, "At least one staff member or resource must be allocated.")

    appt_start = to_utc_naive(payload.start_time)
    if enforce_future and appt_start < utc_now() - timedelta(minutes=5):
        raise HTTPException(400, "Appointment start_time cannot be in the past.")

    service_duration = service.default_duration_minutes

    # (start_offset, end_offset, user_id, resource_id) per allocation, used
    # below to reject a single payload double-booking itself (e.g. the same
    # resource assigned twice with overlapping windows).
    windows = []

    for alloc_data in payload.allocations:
        offset = alloc_data.start_offset_minutes or 0
        duration = alloc_data.duration_minutes or service_duration

        if offset < 0:
            raise HTTPException(400, "Allocation start_offset_minutes must be >= 0.")
        if duration <= 0:
            raise HTTPException(400, "Allocation duration_minutes must be > 0.")
        if offset + duration > service_duration:
            raise HTTPException(
                400,
                f"Allocation window (offset {offset} + duration {duration} min) "
                f"exceeds the service duration ({service_duration} min).",
            )
        windows.append((offset, offset + duration, alloc_data.user_id, alloc_data.resource_id))

        if alloc_data.user_id:
            alloc_user = db.get(User, alloc_data.user_id)
            if not alloc_user:
                raise HTTPException(404, f"User #{alloc_data.user_id} not found.")
            if not alloc_user.is_active:
                raise HTTPException(400, f"User '{alloc_user.name}' is inactive.")
            if alloc_user.clinic_id != clinic_id:
                raise HTTPException(
                    400, f"User '{alloc_user.name}' does not belong to the target clinic."
                )

        if alloc_data.resource_id:
            alloc_resource = db.get(Resource, alloc_data.resource_id)
            if not alloc_resource:
                raise HTTPException(404, f"Resource #{alloc_data.resource_id} not found.")
            if not alloc_resource.is_active:
                raise HTTPException(400, f"Resource '{alloc_resource.name}' is inactive.")
            if alloc_resource.clinic_id != clinic_id:
                raise HTTPException(
                    400, f"Resource '{alloc_resource.name}' does not belong to the target clinic."
                )

    for i in range(len(windows)):
        i_start, i_end, i_user, i_resource = windows[i]
        for j in range(i + 1, len(windows)):
            j_start, j_end, j_user, j_resource = windows[j]
            overlaps = i_start < j_end and j_start < i_end
            if not overlaps:
                continue
            if i_user and i_user == j_user:
                raise HTTPException(
                    400, "This appointment assigns the same staff member twice with overlapping time windows."
                )
            if i_resource and i_resource == j_resource:
                raise HTTPException(
                    400, "This appointment assigns the same resource twice with overlapping time windows."
                )

    violations = _evaluate_rules(
        payload.service_id,
        payload.allocations,
        db,
        appt_start=appt_start,
        service_duration=service_duration,
    )
    hard_violations = [v for v in violations if v.is_hard_stop]
    soft_violations = [v for v in violations if not v.is_hard_stop]

    # Always compute conflicts so callers can require an authorizer / audit when
    # override_double_booking is set. Callers decide whether to block or allow.
    conflicts = _check_double_booking(
        payload.allocations,
        appt_start,
        service_duration,
        db,
        exclude_appointment_id=exclude_appointment_id,
    )

    return service, hard_violations, soft_violations, conflicts


# ── Appointments ──────────────────────────────────────────────────────────────

ALLOWED_STATUS_TRANSITIONS = {
    "scheduled": {"completed", "cancelled", "no_show"},
    "no_show": {"scheduled", "cancelled"},
    "completed": {"scheduled"},  # reopen if marked by mistake
    "cancelled": set(),  # terminal — create a new appointment instead
}


def _apply_status_transition(appt: Appointment, new_status: str):
    if new_status == appt.status:
        return
    allowed = ALLOWED_STATUS_TRANSITIONS.get(appt.status, set())
    if new_status not in allowed:
        raise HTTPException(
            400,
            f"Cannot transition appointment from '{appt.status}' to '{new_status}'.",
        )
    appt.status = new_status


def _assert_override_authorizer(
    user_id: Optional[int], clinic_id: int, db: Session, current_user: User
):
    """
    Ensure overriding_user_id is a legitimate authorizer for this override.

    The named authorizer must be the person actually making the request, or
    the request must be made by a clinic/system admin acting on the clinic's
    behalf. Without this, any authenticated staff member could attribute an
    override to someone else (e.g. the lead vet) with no proof that person
    approved it — defeating the point of the OverrideLog audit trail.
    """
    if user_id is None:
        return
    authorizer = db.get(User, user_id)
    if not authorizer or not authorizer.is_active:
        raise HTTPException(400, "Authorizing staff member not found or inactive.")
    if authorizer.system_role == "SYSTEM_ADMIN":
        raise HTTPException(400, "System administrators cannot be used as override authorizers.")
    if authorizer.clinic_id != clinic_id:
        raise HTTPException(400, "Authorizing staff member does not belong to the target clinic.")
    if user_id != current_user.id and current_user.system_role not in ("CLINIC_ADMIN", "SYSTEM_ADMIN"):
        raise HTTPException(
            400,
            "You can only authorize an override as yourself, unless you are a clinic admin.",
        )


def _resolve_client_patient(payload, clinic_id: int, current_user: User, db: Session):
    """
    Resolve client/patient entities for a booking.
    Prefers IDs. Free-text names find-or-create only when unambiguous.
    Returns (client_id, patient_id, client_name, patient_name).
    """
    client = None
    patient = None

    if payload.client_id:
        client = db.get(Client, payload.client_id)
        if not client or client.clinic_id != clinic_id:
            raise HTTPException(400, "Client not found in target clinic.")
        if not client.is_active:
            raise HTTPException(400, "Client is inactive.")
    elif payload.client_name is not None:
        name = (payload.client_name or "").strip()
        if not name:
            raise HTTPException(400, "client_name cannot be blank.")
        matches = (
            db.query(Client)
            .filter(
                Client.clinic_id == clinic_id,
                Client.name == name,
                Client.is_active == True,
            )
            .all()
        )
        if len(matches) > 1:
            raise HTTPException(
                400,
                "Multiple clients share that name — select an existing client by id.",
            )
        if len(matches) == 1:
            client = matches[0]
        else:
            client = Client(
                clinic_id=clinic_id,
                name=name,
                is_active=True,
                created_at=utc_now(),
                updated_at=utc_now(),
                created_by_user_id=current_user.id,
            )
            db.add(client)
            db.flush()

    if payload.patient_id:
        patient = db.get(Patient, payload.patient_id)
        if not patient or patient.clinic_id != clinic_id:
            raise HTTPException(400, "Patient not found in target clinic.")
        if not patient.is_active:
            raise HTTPException(400, "Patient is inactive.")
        if client and patient.client_id != client.id:
            raise HTTPException(400, "Patient does not belong to the selected client.")
        if not client:
            client = db.get(Client, patient.client_id)
    elif payload.patient_name is not None:
        name = (payload.patient_name or "").strip()
        if not name:
            raise HTTPException(400, "patient_name cannot be blank.")
        if not client:
            raise HTTPException(400, "A client is required before creating a patient by name.")
        matches = (
            db.query(Patient)
            .filter(
                Patient.client_id == client.id,
                Patient.name == name,
                Patient.is_active == True,
            )
            .all()
        )
        if len(matches) > 1:
            raise HTTPException(
                400,
                "Multiple patients share that name under this client — select by id.",
            )
        if len(matches) == 1:
            patient = matches[0]
        else:
            patient = Patient(
                clinic_id=clinic_id,
                client_id=client.id,
                name=name,
                is_active=True,
                created_at=utc_now(),
                updated_at=utc_now(),
                created_by_user_id=current_user.id,
            )
            db.add(patient)
            db.flush()

    if not client or not patient:
        raise HTTPException(400, "Both client and patient are required.")

    return (client.id, patient.id, client.name, patient.name)


def _allocation_out(alloc: AppointmentAllocation, appt_start: datetime) -> AllocationOut:
    offset = 0
    duration = None
    if alloc.start_time is not None and appt_start is not None:
        offset = max(0, int((alloc.start_time - appt_start).total_seconds() // 60))
    if alloc.start_time is not None and alloc.end_time is not None:
        duration = max(1, int((alloc.end_time - alloc.start_time).total_seconds() // 60))
    return AllocationOut(
        id=alloc.id,
        user_id=alloc.user_id,
        resource_id=alloc.resource_id,
        presence_type=alloc.presence_type,
        start_time=alloc.start_time,
        end_time=alloc.end_time,
        start_offset_minutes=offset,
        duration_minutes=duration,
    )


def _appointment_out(appt: Appointment) -> AppointmentOut:
    return AppointmentOut(
        id=appt.id,
        clinic_id=appt.clinic_id,
        service_id=appt.service_id,
        client_id=appt.client_id,
        patient_id=appt.patient_id,
        start_time=appt.start_time,
        end_time=appt.end_time,
        client_name=appt.client_name,
        patient_name=appt.patient_name,
        status=appt.status,
        allocations=[
            _allocation_out(a, appt.start_time) for a in (appt.allocations or [])
        ],
        created_at=appt.created_at,
        updated_at=appt.updated_at,
        created_by_user_id=appt.created_by_user_id,
        updated_by_user_id=appt.updated_by_user_id,
    )


def _load_appointment(db: Session, appointment_id: int) -> Optional[Appointment]:
    return (
        db.query(Appointment)
        .options(joinedload(Appointment.allocations))
        .filter(Appointment.id == appointment_id)
        .first()
    )


@app.get("/api/appointments", response_model=AppointmentListOut)
def list_appointments(
    status: Optional[str] = Query(None),
    include_cancelled: bool = Query(False),
    start: Optional[datetime] = Query(
        None, description="Inclusive lower bound on appointment start_time (UTC)."
    ),
    end: Optional[datetime] = Query(
        None, description="Exclusive upper bound on appointment start_time (UTC)."
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Default window when callers omit bounds — avoids loading unbounded history.
    if start is None and end is None:
        now = utc_now()
        start = now - timedelta(days=7)
        end = now + timedelta(days=60)

    start_bound = to_utc_naive(start) if start is not None else None
    end_bound = to_utc_naive(end) if end is not None else None
    if start_bound is not None and end_bound is not None and start_bound >= end_bound:
        raise HTTPException(400, "Query param 'start' must be earlier than 'end'.")

    if status is not None and status not in APPOINTMENT_STATUSES:
        raise HTTPException(400, f"status must be one of {APPOINTMENT_STATUSES}.")

    q = clinic_filter(db.query(Appointment), Appointment, current_user)
    if status:
        q = q.filter(Appointment.status == status)
    elif not include_cancelled:
        q = q.filter(Appointment.status != "cancelled")
    if start_bound is not None:
        q = q.filter(Appointment.start_time >= start_bound)
    if end_bound is not None:
        q = q.filter(Appointment.start_time < end_bound)

    total = q.count()
    items = (
        q.order_by(Appointment.start_time.desc())
        .options(joinedload(Appointment.allocations))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return AppointmentListOut(
        items=[_appointment_out(a) for a in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@app.get("/api/appointments/{appointment_id}", response_model=AppointmentOut)
def get_appointment(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    appt = _load_appointment(db, appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and appt.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")
    return _appointment_out(appt)


@app.post("/api/appointments/validate", response_model=AppointmentValidateOut)
def validate_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clinic_id = _resolve_appointment_clinic_id(payload, current_user)
    _, hard, soft, conflicts = _validate_appointment_inputs(payload, clinic_id, db)
    soft_blocking = soft and not payload.override
    conflict_blocking = conflicts and not payload.override_double_booking
    return AppointmentValidateOut(
        valid=not hard and not soft_blocking and not conflict_blocking,
        hard_violations=hard,
        soft_violations=soft,
        double_booking_conflicts=conflicts,
    )


@app.post("/api/appointments", status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clinic_id = _resolve_appointment_clinic_id(payload, current_user)
    service, hard_violations, soft_violations, conflicts = _validate_appointment_inputs(
        payload, clinic_id, db
    )
    service_duration = service.default_duration_minutes

    if hard_violations:
        log_event(
            "booking_hard_stop",
            level=30,
            user_id=current_user.id,
            clinic_id=clinic_id,
            detail=f"{len(hard_violations)} violation(s)",
        )
        raise HTTPException(400, detail={
            "type": "hard_stop",
            "violations": [v.model_dump() for v in hard_violations],
        })

    if soft_violations and not payload.override:
        log_event(
            "booking_soft_stop",
            level=30,
            user_id=current_user.id,
            clinic_id=clinic_id,
            detail=f"{len(soft_violations)} violation(s)",
        )
        raise HTTPException(422, detail={
            "type": "soft_stop",
            "violations": [v.model_dump() for v in soft_violations],
        })

    if payload.override and soft_violations and not payload.overriding_user_id:
        raise HTTPException(
            400, "An authorizing staff member (overriding_user_id) is required to override a soft stop."
        )

    if conflicts and not payload.override_double_booking:
        log_event(
            "booking_double_booking",
            level=30,
            user_id=current_user.id,
            clinic_id=clinic_id,
            detail=f"{len(conflicts)} conflict(s)",
        )
        raise HTTPException(400, detail={
            "type": "double_booking",
            "conflicts": conflicts,
        })

    if payload.override_double_booking and conflicts and not payload.overriding_user_id:
        raise HTTPException(
            400,
            "An authorizing staff member (overriding_user_id) is required to override a double-booking.",
        )

    if payload.overriding_user_id and (
        (payload.override and soft_violations)
        or (payload.override_double_booking and conflicts)
    ):
        _assert_override_authorizer(payload.overriding_user_id, clinic_id, db, current_user)

    start_time = to_utc_naive(payload.start_time)
    # Lock the user/resource master rows, then re-check for conflicts under the lock.
    _lock_allocation_targets(payload.allocations, db)
    conflicts = _check_double_booking(payload.allocations, start_time, service_duration, db)
    if conflicts and not payload.override_double_booking:
        raise HTTPException(400, detail={
            "type": "double_booking",
            "conflicts": conflicts,
        })
    if conflicts and payload.override_double_booking and not payload.overriding_user_id:
        raise HTTPException(
            400,
            "An authorizing staff member (overriding_user_id) is required to override a double-booking.",
        )
    if conflicts and payload.override_double_booking and payload.overriding_user_id:
        _assert_override_authorizer(payload.overriding_user_id, clinic_id, db, current_user)

    client_id, patient_id, client_name, patient_name = _resolve_client_patient(
        payload, clinic_id, current_user, db
    )
    end_time = start_time + timedelta(minutes=service_duration)
    now = utc_now()
    appt = Appointment(
        clinic_id=clinic_id,
        service_id=payload.service_id,
        client_id=client_id,
        patient_id=patient_id,
        start_time=start_time,
        end_time=end_time,
        client_name=client_name,
        patient_name=patient_name,
        status="scheduled",
        created_at=now,
        updated_at=now,
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )

    try:
        db.add(appt)
        db.flush()

        for alloc_data in payload.allocations:
            offset = alloc_data.start_offset_minutes or 0
            duration = alloc_data.duration_minutes or service_duration
            db.add(AppointmentAllocation(
                appointment_id=appt.id,
                user_id=alloc_data.user_id,
                resource_id=alloc_data.resource_id,
                start_time=start_time + timedelta(minutes=offset),
                end_time=start_time + timedelta(minutes=offset + duration),
                presence_type=alloc_data.presence_type,
                created_at=now,
                updated_at=now,
            ))

        if payload.override and soft_violations and payload.overriding_user_id:
            for v in soft_violations:
                db.add(OverrideLog(
                    appointment_id=appt.id,
                    rule_id=v.rule_id,
                    overridden_by_user_id=payload.overriding_user_id,
                    override_type="soft_stop",
                    timestamp=now,
                ))
            log_event(
                "booking_override",
                user_id=current_user.id,
                clinic_id=clinic_id,
                appointment_id=appt.id,
                override_type="soft_stop",
                detail=f"authorizer={payload.overriding_user_id} rules={len(soft_violations)}",
            )

        # Only audit when an actual conflict was overridden
        if payload.override_double_booking and conflicts and payload.overriding_user_id:
            names = ", ".join(c["entity"] for c in conflicts)
            db.add(OverrideLog(
                appointment_id=appt.id,
                rule_id=None,
                overridden_by_user_id=payload.overriding_user_id,
                override_type="double_booking",
                notes=f"Overrode conflicts: {names}",
                timestamp=now,
            ))
            log_event(
                "booking_override",
                user_id=current_user.id,
                clinic_id=clinic_id,
                appointment_id=appt.id,
                override_type="double_booking",
                detail=names,
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="db_write")

    db.refresh(appt)
    log_event(
        "appointment_created",
        user_id=current_user.id,
        clinic_id=clinic_id,
        appointment_id=appt.id,
    )
    return _appointment_out(_load_appointment(db, appt.id))


@app.patch("/api/appointments/{appointment_id}", response_model=AppointmentOut)
def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from schemas import AllocationIn

    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and appt.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    status_only = set(data.keys()) <= {"status"}

    if status_only:
        if "status" in data:
            _apply_status_transition(appt, data["status"])
        appt.updated_at = utc_now()
        appt.updated_by_user_id = current_user.id
        db.commit()
        db.refresh(appt)
        log_event(
            "appointment_updated",
            user_id=current_user.id,
            clinic_id=appt.clinic_id,
            appointment_id=appt.id,
            detail="status_only",
        )
        return _appointment_out(_load_appointment(db, appt.id))

    if appt.status == "cancelled":
        raise HTTPException(400, "Cancelled appointments cannot be rescheduled; create a new one.")

    start_time = to_utc_naive(payload.start_time) if payload.start_time else appt.start_time
    service_id = payload.service_id or appt.service_id
    allocations = payload.allocations
    if allocations is None:
        service = db.get(Service, service_id)
        service_duration = service.default_duration_minutes if service else 30
        allocations = []
        for a in appt.allocations:
            offset = int((a.start_time - appt.start_time).total_seconds() // 60) if a.start_time else 0
            duration = (
                int((a.end_time - a.start_time).total_seconds() // 60)
                if a.start_time and a.end_time else service_duration
            )
            allocations.append(AllocationIn(
                user_id=a.user_id,
                resource_id=a.resource_id,
                presence_type=a.presence_type,
                start_offset_minutes=max(offset, 0),
                duration_minutes=max(duration, 1),
            ))

    create_like = AppointmentCreate(
        clinic_id=appt.clinic_id,
        service_id=service_id,
        start_time=start_time,
        client_id=payload.client_id if payload.client_id is not None else appt.client_id,
        patient_id=payload.patient_id if payload.patient_id is not None else appt.patient_id,
        client_name=payload.client_name or appt.client_name,
        patient_name=payload.patient_name or appt.patient_name,
        allocations=allocations,
        override=payload.override,
        overriding_user_id=payload.overriding_user_id,
        override_double_booking=payload.override_double_booking,
    )

    service, hard, soft, conflicts = _validate_appointment_inputs(
        create_like,
        appt.clinic_id,
        db,
        exclude_appointment_id=appt.id,
        enforce_future=payload.start_time is not None,
    )
    service_duration = service.default_duration_minutes

    if hard:
        raise HTTPException(400, detail={"type": "hard_stop", "violations": [v.model_dump() for v in hard]})
    if soft and not payload.override:
        raise HTTPException(422, detail={"type": "soft_stop", "violations": [v.model_dump() for v in soft]})
    if payload.override and soft and not payload.overriding_user_id:
        raise HTTPException(400, "overriding_user_id required to override soft stop.")
    if conflicts and not payload.override_double_booking:
        raise HTTPException(400, detail={"type": "double_booking", "conflicts": conflicts})
    if payload.override_double_booking and conflicts and not payload.overriding_user_id:
        raise HTTPException(400, "overriding_user_id required to override a double-booking.")

    if payload.overriding_user_id and (
        (payload.override and soft)
        or (payload.override_double_booking and conflicts)
    ):
        _assert_override_authorizer(payload.overriding_user_id, appt.clinic_id, db, current_user)

    # Lock the user/resource master rows (see create_appointment), then re-check.
    _lock_allocation_targets(allocations, db)
    conflicts = _check_double_booking(
        allocations,
        start_time,
        service_duration,
        db,
        exclude_appointment_id=appt.id,
    )
    if conflicts and not payload.override_double_booking:
        raise HTTPException(400, detail={"type": "double_booking", "conflicts": conflicts})
    if conflicts and payload.override_double_booking and not payload.overriding_user_id:
        raise HTTPException(400, "overriding_user_id required to override a double-booking.")
    if conflicts and payload.override_double_booking and payload.overriding_user_id:
        _assert_override_authorizer(payload.overriding_user_id, appt.clinic_id, db, current_user)

    if "status" in data:
        _apply_status_transition(appt, data["status"])

    client_id, patient_id, client_name, patient_name = _resolve_client_patient(
        create_like, appt.clinic_id, current_user, db
    )

    appt.service_id = service_id
    appt.start_time = start_time
    appt.end_time = start_time + timedelta(minutes=service_duration)
    appt.client_id = client_id
    appt.patient_id = patient_id
    appt.client_name = client_name
    appt.patient_name = patient_name
    appt.updated_at = utc_now()
    appt.updated_by_user_id = current_user.id

    for old in list(appt.allocations):
        db.delete(old)
    db.flush()
    now = utc_now()
    for alloc_data in allocations:
        offset = alloc_data.start_offset_minutes or 0
        duration = alloc_data.duration_minutes or service_duration
        db.add(AppointmentAllocation(
            appointment_id=appt.id,
            user_id=alloc_data.user_id,
            resource_id=alloc_data.resource_id,
            start_time=start_time + timedelta(minutes=offset),
            end_time=start_time + timedelta(minutes=offset + duration),
            presence_type=alloc_data.presence_type,
            created_at=now,
            updated_at=now,
        ))

    if payload.override and soft and payload.overriding_user_id:
        for v in soft:
            db.add(OverrideLog(
                appointment_id=appt.id,
                rule_id=v.rule_id,
                overridden_by_user_id=payload.overriding_user_id,
                override_type="soft_stop",
                timestamp=now,
            ))
        log_event(
            "booking_override",
            user_id=current_user.id,
            clinic_id=appt.clinic_id,
            appointment_id=appt.id,
            override_type="soft_stop",
            detail=f"authorizer={payload.overriding_user_id} rules={len(soft)}",
        )
    if payload.override_double_booking and conflicts and payload.overriding_user_id:
        names = ", ".join(c["entity"] for c in conflicts)
        db.add(OverrideLog(
            appointment_id=appt.id,
            rule_id=None,
            overridden_by_user_id=payload.overriding_user_id,
            override_type="double_booking",
            notes=f"Overrode conflicts: {names}",
            timestamp=now,
        ))
        log_event(
            "booking_override",
            user_id=current_user.id,
            clinic_id=appt.clinic_id,
            appointment_id=appt.id,
            override_type="double_booking",
            detail=names,
        )

    try:
        db.commit()
        db.refresh(appt)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="db_write")
    log_event(
        "appointment_updated",
        user_id=current_user.id,
        clinic_id=appt.clinic_id,
        appointment_id=appt.id,
        detail="reschedule",
    )
    return _appointment_out(_load_appointment(db, appt.id))


@app.post("/api/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and appt.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")
    _apply_status_transition(appt, "cancelled")
    appt.updated_at = utc_now()
    appt.updated_by_user_id = current_user.id
    db.commit()
    db.refresh(appt)
    log_event(
        "appointment_cancelled",
        user_id=current_user.id,
        clinic_id=appt.clinic_id,
        appointment_id=appt.id,
    )
    return _appointment_out(_load_appointment(db, appt.id))


def _services_by_id(db: Session, service_ids) -> dict:
    """Batch-fetch services by id (avoids a per-row db.get(Service, ...) in schedule loops)."""
    ids = {sid for sid in service_ids if sid is not None}
    if not ids:
        return {}
    return {s.id: s for s in db.query(Service).filter(Service.id.in_(ids)).all()}


@app.get("/api/users/{user_id}/schedule", response_model=List[ScheduleEventOut])
def get_user_schedule(
    user_id: int,
    start: datetime = Query(...),
    end: datetime = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user = db.get(User, user_id)
    if not target_user:
        raise HTTPException(404, "User not found.")

    if current_user.system_role == "USER":
        # Regular users may only view their own schedule
        if current_user.id != user_id:
            raise HTTPException(403, "Access denied.")
    elif current_user.system_role == "CLINIC_ADMIN":
        # Clinic admins may only view schedules within their own clinic
        if target_user.clinic_id != current_user.clinic_id:
            raise HTTPException(403, "Access denied.")

    # Normalize to naive datetimes since the DB stores without TZ
    start_naive = to_utc_naive(start)
    end_naive = to_utc_naive(end)
    if start_naive >= end_naive:
        raise HTTPException(400, "Query param 'start' must be earlier than 'end'.")

    allocations = (
        db.query(AppointmentAllocation)
        .join(Appointment)
        .filter(
            AppointmentAllocation.user_id == user_id,
            AppointmentAllocation.start_time.isnot(None),
            AppointmentAllocation.start_time < end_naive,
            AppointmentAllocation.end_time > start_naive,
            Appointment.status != "cancelled",
        )
        .all()
    )

    services_by_id = _services_by_id(db, {a.appointment.service_id for a in allocations})
    result = []
    for alloc in allocations:
        appt = alloc.appointment
        service = services_by_id.get(appt.service_id)
        result.append(ScheduleEventOut(
            allocation_id=alloc.id,
            appointment_id=appt.id,
            start_time=alloc.start_time,
            end_time=alloc.end_time,
            presence_type=alloc.presence_type,
            client_name=appt.client_name,
            patient_name=appt.patient_name,
            service_name=service.name if service else "Unknown",
            status=appt.status,
        ))

    return result


@app.get("/api/resources/{resource_id}/schedule", response_model=List[ScheduleEventOut])
def get_resource_schedule(
    resource_id: int,
    start: datetime = Query(...),
    end: datetime = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(404, "Resource not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and resource.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    start_naive = to_utc_naive(start)
    end_naive = to_utc_naive(end)
    if start_naive >= end_naive:
        raise HTTPException(400, "Query param 'start' must be earlier than 'end'.")

    allocations = (
        db.query(AppointmentAllocation)
        .join(Appointment)
        .filter(
            AppointmentAllocation.resource_id == resource_id,
            AppointmentAllocation.start_time.isnot(None),
            AppointmentAllocation.start_time < end_naive,
            AppointmentAllocation.end_time > start_naive,
            Appointment.status != "cancelled",
        )
        .all()
    )

    services_by_id = _services_by_id(db, {a.appointment.service_id for a in allocations})
    result = []
    for alloc in allocations:
        appt = alloc.appointment
        service = services_by_id.get(appt.service_id)
        result.append(ScheduleEventOut(
            allocation_id=alloc.id,
            appointment_id=appt.id,
            start_time=alloc.start_time,
            end_time=alloc.end_time,
            client_name=appt.client_name,
            patient_name=appt.patient_name,
            service_name=service.name if service else "Unknown",
            status=appt.status,
        ))

    return result

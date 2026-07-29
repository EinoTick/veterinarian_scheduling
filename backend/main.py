from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import (
    clinic_filter, create_access_token, get_current_user,
    hash_password, require_clinic_admin, require_system_admin, verify_password,
)
from database import SessionLocal, engine, get_db
from models import (
    Appointment, AppointmentAllocation, Base, Clinic, OverrideLog,
    Resource, Role, Rule, Service, User,
)
from schemas import (
    AppointmentCreate, AppointmentOut, AppointmentValidateOut, ClinicOut, PasswordChange,
    ResourceOut, RoleOut, RuleCreate, RuleOut, RuleUpdate, ServiceOut,
    SoftStopResponse, Token, UserCreate, UserOut, ViolationDetail,
)

app = FastAPI(title="VetClinic Scheduler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


# ── Seed ──────────────────────────────────────────────────────────────────────

def seed_db(db: Session):
    if db.query(Clinic).count():
        return

    # Demo clinic
    clinic = Clinic(name="Riverside Animal Hospital")
    db.add(clinic)
    db.flush()

    # Clinical roles
    vet = Role(name="Veterinarian", can_prescribe=True)
    tech = Role(name="Licensed Tech", can_prescribe=False)
    assistant = Role(name="Assistant", can_prescribe=False)
    db.add_all([vet, tech, assistant])
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


def run_migrations(db: Session):
    """Idempotently add new columns to existing tables."""
    conn = db.connection()
    stmts = [
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS duration_minutes INTEGER",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS start_offset_minutes INTEGER DEFAULT 0",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS presence_type VARCHAR",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS alternative_role_ids JSON",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS required_resource_type VARCHAR",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS required_resource_category VARCHAR",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS min_quantity INTEGER DEFAULT 1",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_weekdays JSON",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_start_time VARCHAR",
        "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_end_time VARCHAR",
        "ALTER TABLE resources ADD COLUMN IF NOT EXISTS category VARCHAR",
        "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS start_time TIMESTAMP",
        "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS end_time TIMESTAMP",
        "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS presence_type VARCHAR",
        # Backfill categories on seed-named resources (safe no-ops if names differ)
        "UPDATE resources SET category = 'dental_suite' WHERE name LIKE 'Dental Suite%' AND category IS NULL",
        "UPDATE resources SET category = 'surgery_suite' WHERE name LIKE 'Surgery Suite%' AND category IS NULL",
        "UPDATE resources SET category = 'exam_room' WHERE name LIKE 'Exam Room%' AND category IS NULL",
        "UPDATE resources SET category = 'imaging' WHERE name LIKE 'X-Ray%' AND category IS NULL",
        "UPDATE rules SET is_active = TRUE WHERE is_active IS NULL",
        "UPDATE rules SET min_quantity = 1 WHERE min_quantity IS NULL",
    ]
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
        except Exception:
            pass
    db.commit()


@app.on_event("startup")
def on_startup():
    with SessionLocal() as db:
        run_migrations(db)
        seed_db(db)


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/api/auth/token", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({
        "sub": str(user.id),
        "system_role": user.system_role,
        "clinic_id": user.clinic_id,
    })
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/auth/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.post("/api/auth/change-password")
def change_password(
    payload: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(400, "Current password is incorrect.")
    try:
        current_user.hashed_password = hash_password(payload.new_password)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=str(exc))
    return {"detail": "Password updated."}


# ── User management (CLINIC_ADMIN+) ──────────────────────────────────────────

@app.get("/api/users", response_model=List[UserOut])
def list_users(
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    # Multi-tenancy: SYSTEM_ADMIN sees all, CLINIC_ADMIN sees only their clinic
    q = db.query(User).filter(User.is_active == True)
    return clinic_filter(q, User, current_user).all()


@app.post("/api/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(400, "Email already registered.")

    # CLINIC_ADMIN can only create users for their own clinic
    target_clinic_id = (
        payload.clinic_id if current_user.system_role == "SYSTEM_ADMIN"
        else current_user.clinic_id
    )

    try:
        user = User(
            name=payload.name,
            email=payload.email,
            hashed_password=hash_password(payload.password),
            system_role=payload.system_role,
            role_id=payload.role_id,
            clinic_id=target_clinic_id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=str(exc))

    return user


# ── Reference data (auth-protected, clinic-scoped) ────────────────────────────

@app.get("/api/clinics", response_model=List[ClinicOut])
def list_clinics(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Clinic).all()


@app.get("/api/roles", response_model=List[RoleOut])
def list_roles(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Role).all()


@app.get("/api/resources", response_model=List[ResourceOut])
def list_resources(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return clinic_filter(db.query(Resource), Resource, current_user).all()


@app.get("/api/services", response_model=List[ServiceOut])
def list_services(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return clinic_filter(db.query(Service), Service, current_user).all()


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
        raise HTTPException(500, detail=str(exc))

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
        raise HTTPException(400, detail=str(exc)) from exc

    _validate_rule_refs(probe, rule.clinic_id, db)

    try:
        db.commit()
        db.refresh(rule)
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=str(exc))
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
        raise HTTPException(500, detail=str(exc))
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

    if payload.required_role_id and not db.get(Role, payload.required_role_id):
        raise HTTPException(404, "Role not found.")
    if payload.alternative_role_ids:
        for rid in payload.alternative_role_ids:
            if not db.get(Role, rid):
                raise HTTPException(404, f"Alternative role #{rid} not found.")

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


def _rule_applies_at(rule: Rule, appt_start: datetime) -> bool:
    """Return False when the appointment falls outside the rule's day/time window."""
    if rule.active_weekdays is not None and len(rule.active_weekdays) > 0:
        if appt_start.weekday() not in rule.active_weekdays:
            return False

    appt_hm = appt_start.strftime("%H:%M")
    if rule.active_start_time and appt_hm < rule.active_start_time:
        return False
    if rule.active_end_time and appt_hm >= rule.active_end_time:
        return False
    return True


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

    if service_duration is None:
        service = db.get(Service, service_id)
        service_duration = service.default_duration_minutes if service else 30

    norms = [_normalize_alloc_for_eval(a, service_duration) for a in allocations]
    violations = []

    for rule in rules:
        if appt_start is not None and not _rule_applies_at(rule, appt_start):
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


def _check_double_booking(allocations_in, appt_start, service_duration, db):
    conflicts = []
    for alloc_data in allocations_in:
        offset = alloc_data.start_offset_minutes or 0
        duration = alloc_data.duration_minutes or service_duration
        alloc_start = appt_start + timedelta(minutes=offset)
        alloc_end = alloc_start + timedelta(minutes=duration)

        if alloc_data.user_id:
            overlap = db.query(AppointmentAllocation).filter(
                AppointmentAllocation.user_id == alloc_data.user_id,
                AppointmentAllocation.start_time.isnot(None),
                AppointmentAllocation.start_time < alloc_end,
                AppointmentAllocation.end_time > alloc_start,
            ).first()
            if overlap:
                user = db.get(User, alloc_data.user_id)
                conflicts.append({
                    "entity": user.name if user else f"User #{alloc_data.user_id}",
                    "entity_type": "user",
                })

        if alloc_data.resource_id:
            overlap = db.query(AppointmentAllocation).filter(
                AppointmentAllocation.resource_id == alloc_data.resource_id,
                AppointmentAllocation.start_time.isnot(None),
                AppointmentAllocation.start_time < alloc_end,
                AppointmentAllocation.end_time > alloc_start,
            ).first()
            if overlap:
                resource = db.get(Resource, alloc_data.resource_id)
                conflicts.append({
                    "entity": resource.name if resource else f"Resource #{alloc_data.resource_id}",
                    "entity_type": "resource",
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


def _validate_appointment_inputs(payload: AppointmentCreate, clinic_id: int, db: Session):
    """
    Shared validation for create + preview. Returns
    (service, hard_violations, soft_violations, conflicts).
    Raises HTTPException for hard input errors (missing service, bad tenant, bad offsets).
    """
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found.")
    if service.clinic_id != clinic_id:
        raise HTTPException(400, "Service does not belong to the target clinic.")

    service_duration = service.default_duration_minutes

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

        if alloc_data.user_id:
            alloc_user = db.get(User, alloc_data.user_id)
            if not alloc_user:
                raise HTTPException(404, f"User #{alloc_data.user_id} not found.")
            if alloc_user.clinic_id != clinic_id:
                raise HTTPException(
                    400, f"User '{alloc_user.name}' does not belong to the target clinic."
                )

        if alloc_data.resource_id:
            alloc_resource = db.get(Resource, alloc_data.resource_id)
            if not alloc_resource:
                raise HTTPException(404, f"Resource #{alloc_data.resource_id} not found.")
            if alloc_resource.clinic_id != clinic_id:
                raise HTTPException(
                    400, f"Resource '{alloc_resource.name}' does not belong to the target clinic."
                )

    violations = _evaluate_rules(
        payload.service_id,
        payload.allocations,
        db,
        appt_start=payload.start_time.replace(tzinfo=None) if payload.start_time.tzinfo else payload.start_time,
        service_duration=service_duration,
    )
    hard_violations = [v for v in violations if v.is_hard_stop]
    soft_violations = [v for v in violations if not v.is_hard_stop]

    conflicts = []
    if not payload.override_double_booking:
        conflicts = _check_double_booking(
            payload.allocations,
            payload.start_time.replace(tzinfo=None) if payload.start_time.tzinfo else payload.start_time,
            service_duration,
            db,
        )

    return service, hard_violations, soft_violations, conflicts


# ── Appointments ──────────────────────────────────────────────────────────────

@app.get("/api/appointments", response_model=List[AppointmentOut])
def list_appointments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Appointment).order_by(Appointment.start_time)
    return clinic_filter(q, Appointment, current_user).all()


@app.post("/api/appointments/validate", response_model=AppointmentValidateOut)
def validate_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Preview rule + double-booking violations without creating an appointment."""
    clinic_id = _resolve_appointment_clinic_id(payload, current_user)
    _, hard, soft, conflicts = _validate_appointment_inputs(payload, clinic_id, db)
    return AppointmentValidateOut(
        valid=not hard and not soft and not conflicts,
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
        raise HTTPException(400, detail={
            "type": "hard_stop",
            "violations": [v.model_dump() for v in hard_violations],
        })

    if soft_violations and not payload.override:
        raise HTTPException(422, detail={
            "type": "soft_stop",
            "violations": [v.model_dump() for v in soft_violations],
        })

    if payload.override and soft_violations and not payload.overriding_user_id:
        raise HTTPException(
            400, "An authorizing staff member (overriding_user_id) is required to override a soft stop."
        )

    if conflicts and not payload.override_double_booking:
        raise HTTPException(400, detail={
            "type": "double_booking",
            "conflicts": conflicts,
        })

    # Row-level lock before insert to reduce TOCTOU races
    if not payload.override_double_booking:
        appt_start = payload.start_time.replace(tzinfo=None) if payload.start_time.tzinfo else payload.start_time
        appt_end = appt_start + timedelta(minutes=service_duration)
        for alloc_data in payload.allocations:
            if alloc_data.user_id:
                db.query(AppointmentAllocation).filter(
                    AppointmentAllocation.user_id == alloc_data.user_id,
                    AppointmentAllocation.start_time.isnot(None),
                    AppointmentAllocation.start_time < appt_end,
                    AppointmentAllocation.end_time > appt_start,
                ).with_for_update().all()
            if alloc_data.resource_id:
                db.query(AppointmentAllocation).filter(
                    AppointmentAllocation.resource_id == alloc_data.resource_id,
                    AppointmentAllocation.start_time.isnot(None),
                    AppointmentAllocation.start_time < appt_end,
                    AppointmentAllocation.end_time > appt_start,
                ).with_for_update().all()

        # Re-check after lock
        conflicts = _check_double_booking(payload.allocations, appt_start, service_duration, db)
        if conflicts:
            raise HTTPException(400, detail={
                "type": "double_booking",
                "conflicts": conflicts,
            })

    start_time = payload.start_time.replace(tzinfo=None) if payload.start_time.tzinfo else payload.start_time
    end_time = start_time + timedelta(minutes=service_duration)
    appt = Appointment(
        clinic_id=clinic_id,
        service_id=payload.service_id,
        start_time=start_time,
        end_time=end_time,
        client_name=payload.client_name,
        patient_name=payload.patient_name,
        status="scheduled",
    )

    try:
        db.add(appt)
        db.flush()

        for alloc_data in payload.allocations:
            offset = alloc_data.start_offset_minutes or 0
            duration = alloc_data.duration_minutes or service_duration
            alloc = AppointmentAllocation(
                appointment_id=appt.id,
                user_id=alloc_data.user_id,
                resource_id=alloc_data.resource_id,
                start_time=start_time + timedelta(minutes=offset),
                end_time=start_time + timedelta(minutes=offset + duration),
                presence_type=alloc_data.presence_type,
            )
            db.add(alloc)

        if payload.override and soft_violations and payload.overriding_user_id:
            for v in soft_violations:
                db.add(OverrideLog(
                    appointment_id=appt.id,
                    rule_id=v.rule_id,
                    overridden_by_user_id=payload.overriding_user_id,
                    timestamp=datetime.utcnow(),
                ))

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=str(exc))

    db.refresh(appt)
    return AppointmentOut.model_validate(appt)


@app.get("/api/users/{user_id}/schedule")
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
    start_naive = start.replace(tzinfo=None)
    end_naive = end.replace(tzinfo=None)

    allocations = (
        db.query(AppointmentAllocation)
        .join(Appointment)
        .filter(
            AppointmentAllocation.user_id == user_id,
            AppointmentAllocation.start_time.isnot(None),
            AppointmentAllocation.start_time < end_naive,
            AppointmentAllocation.end_time > start_naive,
        )
        .all()
    )

    result = []
    for alloc in allocations:
        appt = alloc.appointment
        service = db.get(Service, appt.service_id)
        result.append({
            "allocation_id": alloc.id,
            "appointment_id": appt.id,
            "start_time": alloc.start_time.isoformat(),
            "end_time": alloc.end_time.isoformat(),
            "presence_type": alloc.presence_type,
            "client_name": appt.client_name,
            "patient_name": appt.patient_name,
            "service_name": service.name if service else "Unknown",
        })

    return result


@app.get("/api/resources/{resource_id}/schedule")
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

    start_naive = start.replace(tzinfo=None)
    end_naive = end.replace(tzinfo=None)

    allocations = (
        db.query(AppointmentAllocation)
        .join(Appointment)
        .filter(
            AppointmentAllocation.resource_id == resource_id,
            AppointmentAllocation.start_time.isnot(None),
            AppointmentAllocation.start_time < end_naive,
            AppointmentAllocation.end_time > start_naive,
        )
        .all()
    )

    result = []
    for alloc in allocations:
        appt = alloc.appointment
        service = db.get(Service, appt.service_id)
        result.append({
            "allocation_id": alloc.id,
            "appointment_id": appt.id,
            "start_time": alloc.start_time.isoformat(),
            "end_time": alloc.end_time.isoformat(),
            "client_name": appt.client_name,
            "patient_name": appt.patient_name,
            "service_name": service.name if service else "Unknown",
        })

    return result

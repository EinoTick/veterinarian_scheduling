from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
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
    AppointmentCreate, AppointmentOut, ClinicOut, PasswordChange,
    ResourceOut, RoleOut, RuleCreate, RuleOut, ServiceOut,
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

    dental_suite = Resource(clinic_id=clinic.id, name="Dental Suite A", resource_type="room")
    surgery = Resource(clinic_id=clinic.id, name="Surgery Suite 1", resource_type="room")
    xray = Resource(clinic_id=clinic.id, name="X-Ray Unit", resource_type="equipment")
    exam1 = Resource(clinic_id=clinic.id, name="Exam Room 1", resource_type="room")
    exam2 = Resource(clinic_id=clinic.id, name="Exam Room 2", resource_type="room")
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
    ])

    db.commit()


@app.on_event("startup")
def on_startup():
    with SessionLocal() as db:
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
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
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
    return user


# ── Reference data (auth-protected, clinic-scoped) ────────────────────────────

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return clinic_filter(db.query(Rule), Rule, current_user).all()


@app.post("/api/rules", response_model=RuleOut, status_code=201)
def create_rule(
    payload: RuleCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    if not db.get(Service, payload.service_id):
        raise HTTPException(404, "Service not found.")
    if payload.required_role_id and not db.get(Role, payload.required_role_id):
        raise HTTPException(404, "Role not found.")
    if payload.required_resource_id and not db.get(Resource, payload.required_resource_id):
        raise HTTPException(404, "Resource not found.")

    rule = Rule(**payload.model_dump(), clinic_id=current_user.clinic_id)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


# ── Rules engine ──────────────────────────────────────────────────────────────

def _evaluate_rules(service_id, allocations, db):
    rules = db.query(Rule).filter(Rule.service_id == service_id).all()
    if not rules:
        return []

    allocated_user_ids = {a.user_id for a in allocations if a.user_id}
    allocated_resource_ids = {a.resource_id for a in allocations if a.resource_id}

    allocated_role_ids: set[int] = set()
    for uid in allocated_user_ids:
        user = db.get(User, uid)
        if user:
            allocated_role_ids.add(user.role_id)

    violations = []
    for rule in rules:
        satisfied = False
        if rule.required_role_id is not None:
            satisfied = rule.required_role_id in allocated_role_ids
        elif rule.required_resource_id is not None:
            satisfied = rule.required_resource_id in allocated_resource_ids
        if not satisfied:
            violations.append(ViolationDetail(
                rule_id=rule.id,
                description=rule.description,
                is_hard_stop=rule.is_hard_stop,
            ))
    return violations


# ── Appointments ──────────────────────────────────────────────────────────────

@app.get("/api/appointments", response_model=List[AppointmentOut])
def list_appointments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Appointment).order_by(Appointment.start_time)
    return clinic_filter(q, Appointment, current_user).all()


@app.post("/api/appointments", status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found.")

    transient_allocations = [
        AppointmentAllocation(user_id=a.user_id, resource_id=a.resource_id)
        for a in payload.allocations
    ]

    violations = _evaluate_rules(payload.service_id, transient_allocations, db)
    hard_violations = [v for v in violations if v.is_hard_stop]
    soft_violations = [v for v in violations if not v.is_hard_stop]

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

    end_time = payload.start_time + timedelta(minutes=service.default_duration_minutes)
    appt = Appointment(
        clinic_id=current_user.clinic_id,
        service_id=payload.service_id,
        start_time=payload.start_time,
        end_time=end_time,
        client_name=payload.client_name,
        patient_name=payload.patient_name,
        status="scheduled",
    )
    db.add(appt)
    db.flush()

    for alloc in transient_allocations:
        alloc.appointment_id = appt.id
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
    db.refresh(appt)
    return AppointmentOut.model_validate(appt)

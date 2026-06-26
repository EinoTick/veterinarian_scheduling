from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import SessionLocal, engine, get_db
from models import (
    Appointment, AppointmentAllocation, Base, OverrideLog,
    Resource, Role, Rule, Service, User,
)
from schemas import (
    AppointmentCreate, AppointmentOut, ResourceOut, RoleOut,
    RuleCreate, RuleOut, ServiceOut, SoftStopResponse,
    UserOut, ViolationDetail,
)

# ── App setup ─────────────────────────────────────────────────────────────────

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
    if db.query(Role).count():
        return  # already seeded

    vet = Role(name="Veterinarian", can_prescribe=True)
    tech = Role(name="Licensed Tech", can_prescribe=False)
    assistant = Role(name="Assistant", can_prescribe=False)
    db.add_all([vet, tech, assistant])
    db.flush()

    db.add_all([
        User(name="Dr. Sarah Chen", role_id=vet.id, is_active=True),
        User(name="Dr. Marcus Webb", role_id=vet.id, is_active=True),
        User(name="Jamie Torres", role_id=tech.id, is_active=True),
        User(name="Riley Park", role_id=tech.id, is_active=True),
        User(name="Sam Nguyen", role_id=assistant.id, is_active=True),
    ])

    dental_suite = Resource(name="Dental Suite A", resource_type="room")
    surgery = Resource(name="Surgery Suite 1", resource_type="room")
    xray = Resource(name="X-Ray Unit", resource_type="equipment")
    exam1 = Resource(name="Exam Room 1", resource_type="room")
    exam2 = Resource(name="Exam Room 2", resource_type="room")
    db.add_all([dental_suite, surgery, xray, exam1, exam2])
    db.flush()

    dental = Service(name="Dental Cleaning", default_duration_minutes=90)
    surgery_svc = Service(name="Soft Tissue Surgery", default_duration_minutes=120)
    wellness = Service(name="Wellness Exam", default_duration_minutes=30)
    xray_svc = Service(name="Radiograph (X-Ray)", default_duration_minutes=20)
    db.add_all([dental, surgery_svc, wellness, xray_svc])
    db.flush()

    db.add_all([
        # Dental Cleaning rules
        Rule(
            service_id=dental.id,
            required_role_id=tech.id,
            is_hard_stop=True,
            description="Dental Cleaning requires a Licensed Tech to be assigned.",
        ),
        Rule(
            service_id=dental.id,
            required_resource_id=dental_suite.id,
            is_hard_stop=True,
            description="Dental Cleaning must be performed in the Dental Suite.",
        ),
        # Surgery rules
        Rule(
            service_id=surgery_svc.id,
            required_role_id=vet.id,
            is_hard_stop=True,
            description="Surgery requires a Veterinarian.",
        ),
        Rule(
            service_id=surgery_svc.id,
            required_resource_id=surgery.id,
            is_hard_stop=True,
            description="Surgery must be performed in a Surgery Suite.",
        ),
        # X-Ray rule (soft stop — can proceed without, but log it)
        Rule(
            service_id=xray_svc.id,
            required_resource_id=xray.id,
            is_hard_stop=False,
            description="Radiograph should use the dedicated X-Ray Unit (soft warning).",
        ),
    ])

    db.commit()


@app.on_event("startup")
def on_startup():
    with SessionLocal() as db:
        seed_db(db)


# ── Reference data endpoints ──────────────────────────────────────────────────

@app.get("/roles", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db)):
    return db.query(Role).all()


@app.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).filter(User.is_active == True).all()


@app.get("/resources", response_model=List[ResourceOut])
def list_resources(db: Session = Depends(get_db)):
    return db.query(Resource).all()


@app.get("/services", response_model=List[ServiceOut])
def list_services(db: Session = Depends(get_db)):
    return db.query(Service).all()


@app.get("/rules", response_model=List[RuleOut])
def list_rules(db: Session = Depends(get_db)):
    return db.query(Rule).all()


# ── Rule management ───────────────────────────────────────────────────────────

@app.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(payload: RuleCreate, db: Session = Depends(get_db)):
    if not db.get(Service, payload.service_id):
        raise HTTPException(404, "Service not found.")
    if payload.required_role_id and not db.get(Role, payload.required_role_id):
        raise HTTPException(404, "Role not found.")
    if payload.required_resource_id and not db.get(Resource, payload.required_resource_id):
        raise HTTPException(404, "Resource not found.")

    rule = Rule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


# ── Rules engine ──────────────────────────────────────────────────────────────

def _evaluate_rules(
    service_id: int,
    allocations: list[AppointmentAllocation],
    db: Session,
) -> list[ViolationDetail]:
    """
    Returns a list of violated rules for the proposed appointment.
    Allocations are plain dicts (user_id/resource_id) at this point.
    """
    rules: list[Rule] = db.query(Rule).filter(Rule.service_id == service_id).all()
    if not rules:
        return []

    allocated_user_ids = {a.user_id for a in allocations if a.user_id}
    allocated_resource_ids = {a.resource_id for a in allocations if a.resource_id}

    # Resolve role ids for allocated users
    allocated_role_ids: set[int] = set()
    for uid in allocated_user_ids:
        user = db.get(User, uid)
        if user:
            allocated_role_ids.add(user.role_id)

    violations: list[ViolationDetail] = []
    for rule in rules:
        satisfied = False
        if rule.required_role_id is not None:
            satisfied = rule.required_role_id in allocated_role_ids
        elif rule.required_resource_id is not None:
            satisfied = rule.required_resource_id in allocated_resource_ids

        if not satisfied:
            violations.append(
                ViolationDetail(
                    rule_id=rule.id,
                    description=rule.description,
                    is_hard_stop=rule.is_hard_stop,
                )
            )

    return violations


# ── Appointments ──────────────────────────────────────────────────────────────

@app.get("/appointments", response_model=List[AppointmentOut])
def list_appointments(db: Session = Depends(get_db)):
    return db.query(Appointment).order_by(Appointment.start_time).all()


@app.post("/appointments", status_code=201)
def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
    service = db.get(Service, payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found.")

    # Build transient allocation objects for rule evaluation
    transient_allocations = [
        AppointmentAllocation(
            user_id=a.user_id,
            resource_id=a.resource_id,
        )
        for a in payload.allocations
    ]

    violations = _evaluate_rules(payload.service_id, transient_allocations, db)

    hard_violations = [v for v in violations if v.is_hard_stop]
    soft_violations = [v for v in violations if not v.is_hard_stop]

    # Hard stops always block, regardless of override flag
    if hard_violations:
        raise HTTPException(
            status_code=400,
            detail={
                "type": "hard_stop",
                "violations": [v.model_dump() for v in hard_violations],
            },
        )

    # Soft stops block unless caller explicitly overrides
    if soft_violations and not payload.override:
        # Return 422 so frontend can detect and offer the override button
        raise HTTPException(
            status_code=422,
            detail={
                "type": "soft_stop",
                "violations": [v.model_dump() for v in soft_violations],
            },
        )

    end_time = payload.start_time + timedelta(minutes=service.default_duration_minutes)

    appt = Appointment(
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

    # Log overrides for soft-stop violations
    if payload.override and soft_violations and payload.overriding_user_id:
        for v in soft_violations:
            db.add(
                OverrideLog(
                    appointment_id=appt.id,
                    rule_id=v.rule_id,
                    overridden_by_user_id=payload.overriding_user_id,
                    timestamp=datetime.utcnow(),
                )
            )

    db.commit()
    db.refresh(appt)
    return AppointmentOut.model_validate(appt)

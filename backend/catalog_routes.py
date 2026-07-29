"""
Catalog + lifecycle CRUD endpoints (resources, services, roles, clients, patients, users update).
Mounted from main.py.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, joinedload

from auth import clinic_filter, get_current_user, hash_password, require_clinic_admin, revoke_all_refresh_tokens
from database import get_db
from errors import http_internal_error
from models import Client, Patient, Resource, Role, Service, User
from schemas import (
    ClientCreate, ClientOut, ClientUpdate,
    PatientCreate, PatientOut, PatientUpdate,
    ResourceCreate, ResourceOut, ResourceUpdate,
    RoleCreate, RoleOut, RoleUpdate,
    ServiceCreate, ServiceOut, ServiceUpdate,
    UserOut, UserUpdate,
)
from timeutil import utc_now

router = APIRouter()


def _resolve_clinic_id(
    payload_clinic_id: Optional[int],
    current_user: User,
    *,
    allow_none_for_system_admin: bool = False,
) -> Optional[int]:
    if current_user.system_role == "SYSTEM_ADMIN":
        if payload_clinic_id is not None:
            return payload_clinic_id
        if allow_none_for_system_admin:
            return None
        raise HTTPException(400, "System administrators must supply a clinic_id.")
    if current_user.clinic_id is None:
        raise HTTPException(400, "User is not associated with a clinic.")
    return current_user.clinic_id


def _stamp_create(obj, user: User):
    now = utc_now()
    if hasattr(obj, "created_at") and getattr(obj, "created_at", None) is None:
        obj.created_at = now
    if hasattr(obj, "updated_at"):
        obj.updated_at = now
    if hasattr(obj, "created_by_user_id") and user:
        obj.created_by_user_id = user.id


def _stamp_update(obj):
    if hasattr(obj, "updated_at"):
        obj.updated_at = utc_now()


# ── Users ─────────────────────────────────────────────────────────────────────

@router.patch("/api/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and user.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    # CLINIC_ADMIN cannot escalate to SYSTEM_ADMIN or edit system admins
    if current_user.system_role != "SYSTEM_ADMIN":
        if user.system_role == "SYSTEM_ADMIN":
            raise HTTPException(403, "Cannot modify a system administrator.")
        if payload.system_role == "SYSTEM_ADMIN":
            raise HTTPException(403, "Cannot grant system administrator role.")

    data = payload.model_dump(exclude_unset=True)
    if data.get("is_active") is False and user.id == current_user.id:
        raise HTTPException(400, "You cannot deactivate your own account.")
    if data.pop("clear_role_id", False):
        user.role_id = None
    password_changed = False
    if "password" in data:
        pwd = data.pop("password")
        if pwd:
            user.hashed_password = hash_password(pwd)
            password_changed = True
    for key, value in data.items():
        setattr(user, key, value)

    if user.role_id:
        role = db.get(Role, user.role_id)
        if not role or not role.is_active:
            raise HTTPException(400, "Clinical role not found or inactive.")
        if role.clinic_id is not None and role.clinic_id != user.clinic_id:
            raise HTTPException(400, "Clinical role does not belong to the user's clinic.")

    _stamp_update(user)
    try:
        if password_changed:
            revoke_all_refresh_tokens(db, user.id)
        db.commit()
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return user


# ── Roles ─────────────────────────────────────────────────────────────────────

@router.get("/api/roles", response_model=List[RoleOut])
def list_roles(
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Role)
    if not include_inactive:
        q = q.filter(Role.is_active == True)
    # Global roles + own clinic roles
    if current_user.system_role == "SYSTEM_ADMIN":
        return q.order_by(Role.name).all()
    return (
        q.filter((Role.clinic_id.is_(None)) | (Role.clinic_id == current_user.clinic_id))
        .order_by(Role.name)
        .all()
    )


@router.post("/api/roles", response_model=RoleOut, status_code=201)
def create_role(
    payload: RoleCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    if current_user.system_role == "SYSTEM_ADMIN" and payload.is_global:
        clinic_id = None
    else:
        clinic_id = _resolve_clinic_id(payload.clinic_id, current_user)

    # Uniqueness within scope
    existing = (
        db.query(Role)
        .filter(Role.name == payload.name, Role.clinic_id == clinic_id)
        .first()
    )
    if existing:
        raise HTTPException(400, "A role with this name already exists in this scope.")

    role = Role(
        name=payload.name,
        can_prescribe=payload.can_prescribe,
        clinic_id=clinic_id,
        is_active=True,
    )
    _stamp_create(role, current_user)
    try:
        db.add(role)
        db.commit()
        db.refresh(role)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return role


@router.patch("/api/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: int,
    payload: RoleUpdate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found.")
    if role.clinic_id is None and current_user.system_role != "SYSTEM_ADMIN":
        raise HTTPException(403, "Only system administrators can modify global roles.")
    if (
        role.clinic_id is not None
        and current_user.system_role != "SYSTEM_ADMIN"
        and role.clinic_id != current_user.clinic_id
    ):
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(role, key, value)
    _stamp_update(role)
    try:
        db.commit()
        db.refresh(role)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return role


# ── Resources ─────────────────────────────────────────────────────────────────

@router.get("/api/resources", response_model=List[ResourceOut])
def list_resources(
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = clinic_filter(db.query(Resource), Resource, current_user)
    if not include_inactive:
        q = q.filter(Resource.is_active == True)
    return q.order_by(Resource.name).all()


@router.post("/api/resources", response_model=ResourceOut, status_code=201)
def create_resource(
    payload: ResourceCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    clinic_id = _resolve_clinic_id(payload.clinic_id, current_user)
    if payload.resource_type not in ("room", "equipment"):
        raise HTTPException(400, "resource_type must be 'room' or 'equipment'.")

    resource = Resource(
        clinic_id=clinic_id,
        name=payload.name,
        resource_type=payload.resource_type,
        category=payload.category,
        is_active=True,
    )
    _stamp_create(resource, current_user)
    try:
        db.add(resource)
        db.commit()
        db.refresh(resource)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return resource


@router.patch("/api/resources/{resource_id}", response_model=ResourceOut)
def update_resource(
    resource_id: int,
    payload: ResourceUpdate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(404, "Resource not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and resource.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_category", False):
        resource.category = None
    if "resource_type" in data and data["resource_type"] not in ("room", "equipment"):
        raise HTTPException(400, "resource_type must be 'room' or 'equipment'.")
    for key, value in data.items():
        setattr(resource, key, value)
    _stamp_update(resource)
    try:
        db.commit()
        db.refresh(resource)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return resource


@router.delete("/api/resources/{resource_id}", status_code=204)
def delete_resource(
    resource_id: int,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(404, "Resource not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and resource.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")
    resource.is_active = False
    _stamp_update(resource)
    db.commit()
    return Response(status_code=204)


# ── Services ──────────────────────────────────────────────────────────────────

@router.get("/api/services", response_model=List[ServiceOut])
def list_services(
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = clinic_filter(db.query(Service), Service, current_user)
    if not include_inactive:
        q = q.filter(Service.is_active == True)
    return q.order_by(Service.name).all()


@router.post("/api/services", response_model=ServiceOut, status_code=201)
def create_service(
    payload: ServiceCreate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    clinic_id = _resolve_clinic_id(payload.clinic_id, current_user)
    existing = (
        db.query(Service)
        .filter(Service.clinic_id == clinic_id, Service.name == payload.name)
        .first()
    )
    if existing:
        raise HTTPException(400, "A service with this name already exists for this clinic.")

    service = Service(
        clinic_id=clinic_id,
        name=payload.name,
        default_duration_minutes=payload.default_duration_minutes,
        is_active=True,
    )
    _stamp_create(service, current_user)
    try:
        db.add(service)
        db.commit()
        db.refresh(service)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return service


@router.patch("/api/services/{service_id}", response_model=ServiceOut)
def update_service(
    service_id: int,
    payload: ServiceUpdate,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    service = db.get(Service, service_id)
    if not service:
        raise HTTPException(404, "Service not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and service.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(service, key, value)
    _stamp_update(service)
    try:
        db.commit()
        db.refresh(service)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return service


@router.delete("/api/services/{service_id}", status_code=204)
def delete_service(
    service_id: int,
    current_user: User = Depends(require_clinic_admin),
    db: Session = Depends(get_db),
):
    service = db.get(Service, service_id)
    if not service:
        raise HTTPException(404, "Service not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and service.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")
    service.is_active = False
    _stamp_update(service)
    db.commit()
    return Response(status_code=204)


# ── Clients / Patients ────────────────────────────────────────────────────────

@router.get("/api/clients", response_model=List[ClientOut])
def list_clients(
    include_inactive: bool = Query(False),
    q: Optional[str] = Query(None, description="Search by name/email/phone"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = clinic_filter(
        db.query(Client).options(joinedload(Client.patients)),
        Client,
        current_user,
    )
    if not include_inactive:
        query = query.filter(Client.is_active == True)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (Client.name.ilike(like))
            | (Client.email.ilike(like))
            | (Client.phone.ilike(like))
        )
    return query.order_by(Client.name).all()


@router.post("/api/clients", response_model=ClientOut, status_code=201)
def create_client(
    payload: ClientCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clinic_id = _resolve_clinic_id(payload.clinic_id, current_user)
    client = Client(
        clinic_id=clinic_id,
        name=payload.name,
        email=str(payload.email) if payload.email else None,
        phone=payload.phone,
        notes=payload.notes,
        is_active=True,
    )
    _stamp_create(client, current_user)
    try:
        db.add(client)
        db.commit()
        db.refresh(client)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return client


@router.patch("/api/clients/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int,
    payload: ClientUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(404, "Client not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and client.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_email", False):
        client.email = None
    if data.pop("clear_phone", False):
        client.phone = None
    if data.pop("clear_notes", False):
        client.notes = None
    if "email" in data and data["email"] is not None:
        data["email"] = str(data["email"])
    for key, value in data.items():
        setattr(client, key, value)
    _stamp_update(client)
    try:
        db.commit()
        db.refresh(client)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return client


@router.post("/api/patients", response_model=PatientOut, status_code=201)
def create_patient(
    payload: PatientCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(404, "Client not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and client.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    patient = Patient(
        clinic_id=client.clinic_id,
        client_id=client.id,
        name=payload.name,
        species=payload.species,
        breed=payload.breed,
        notes=payload.notes,
        is_active=True,
    )
    _stamp_create(patient, current_user)
    try:
        db.add(patient)
        db.commit()
        db.refresh(patient)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return patient


@router.patch("/api/patients/{patient_id}", response_model=PatientOut)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and patient.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")

    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_species", False):
        patient.species = None
    if data.pop("clear_breed", False):
        patient.breed = None
    if data.pop("clear_notes", False):
        patient.notes = None
    for key, value in data.items():
        setattr(patient, key, value)
    _stamp_update(patient)
    try:
        db.commit()
        db.refresh(patient)
    except Exception as exc:
        db.rollback()
        raise http_internal_error(exc, action="catalog_write")
    return patient


@router.get("/api/clients/{client_id}/patients", response_model=List[PatientOut])
def list_client_patients(
    client_id: int,
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(404, "Client not found.")
    if current_user.system_role != "SYSTEM_ADMIN" and client.clinic_id != current_user.clinic_id:
        raise HTTPException(403, "Access denied.")
    q = db.query(Patient).filter(Patient.client_id == client_id)
    if not include_inactive:
        q = q.filter(Patient.is_active == True)
    return q.order_by(Patient.name).all()

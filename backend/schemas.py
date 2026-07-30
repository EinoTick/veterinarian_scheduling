from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator, model_validator

from password_policy import validate_password_strength


# ── Auth ──────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    """Legacy shape kept for OpenAPI tooling; cookie sessions are preferred."""
    access_token: str
    token_type: str = "bearer"


class AuthSessionOut(BaseModel):
    authenticated: bool = True


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return validate_password_strength(v)


# ── Clinics ───────────────────────────────────────────────────────────────────

def _validate_timezone(v: str) -> str:
    from timeutil import validate_iana_timezone
    name = (v or "").strip() or "UTC"
    return validate_iana_timezone(name)


class ClinicCreate(BaseModel):
    name: str = Field(..., min_length=1)
    timezone: str = "UTC"

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        name = (v or "").strip()
        if not name:
            raise ValueError("Clinic name is required.")
        return name

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        return _validate_timezone(v)


class ClinicUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        name = v.strip()
        if not name:
            raise ValueError("Clinic name cannot be blank.")
        return name

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return _validate_timezone(v)


class ClinicOut(BaseModel):
    id: int
    name: str
    timezone: str = "UTC"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Roles ────────────────────────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str
    can_prescribe: bool = False
    # SYSTEM_ADMIN only: create a clinic-specific role for another clinic,
    # or omit / null for a global catalog role.
    clinic_id: Optional[int] = None
    # If True and caller is SYSTEM_ADMIN with no clinic_id, create as global.
    # CLINIC_ADMIN always creates clinic-scoped roles for their own clinic.
    is_global: bool = False


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    can_prescribe: Optional[bool] = None
    is_active: Optional[bool] = None


class RoleOut(BaseModel):
    id: int
    name: str
    can_prescribe: bool
    clinic_id: Optional[int] = None
    is_active: bool = True

    model_config = {"from_attributes": True}


# ── Users ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    system_role: str = "USER"
    role_id: Optional[int] = None
    clinic_id: Optional[int] = None

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        return validate_password_strength(v)


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    system_role: Optional[str] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    clear_role_id: bool = False
    # Admin password reset (optional)
    password: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        return validate_password_strength(v)


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    system_role: str
    is_active: bool
    clinic_id: Optional[int]
    role: Optional[RoleOut]
    # IANA TZ for the user's clinic (SYSTEM_ADMIN without clinic → None).
    clinic_timezone: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Resources ────────────────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    name: str
    resource_type: str  # room | equipment
    category: Optional[str] = None
    clinic_id: Optional[int] = None  # SYSTEM_ADMIN only


class ResourceUpdate(BaseModel):
    name: Optional[str] = None
    resource_type: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None
    clear_category: bool = False


class ResourceOut(BaseModel):
    id: int
    clinic_id: int
    name: str
    resource_type: str
    category: Optional[str] = None
    is_active: bool = True

    model_config = {"from_attributes": True}


# ── Services ─────────────────────────────────────────────────────────────────

class ServiceCreate(BaseModel):
    name: str
    default_duration_minutes: int = Field(default=30, ge=1)
    clinic_id: Optional[int] = None


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    default_duration_minutes: Optional[int] = Field(default=None, ge=1)
    is_active: Optional[bool] = None


class ServiceOut(BaseModel):
    id: int
    clinic_id: int
    name: str
    default_duration_minutes: int
    is_active: bool = True

    model_config = {"from_attributes": True}


# ── Clients / Patients ───────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    clinic_id: Optional[int] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    clear_email: bool = False
    clear_phone: bool = False
    clear_notes: bool = False


class PatientCreate(BaseModel):
    client_id: int
    name: str
    species: Optional[str] = None
    breed: Optional[str] = None
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    species: Optional[str] = None
    breed: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    clear_species: bool = False
    clear_breed: bool = False
    clear_notes: bool = False


class PatientOut(BaseModel):
    id: int
    clinic_id: int
    client_id: int
    name: str
    species: Optional[str] = None
    breed: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True

    model_config = {"from_attributes": True}


class ClientOut(BaseModel):
    id: int
    clinic_id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    patients: List[PatientOut] = []

    model_config = {"from_attributes": True}


# ── Rules ────────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    service_id: int
    required_role_id: Optional[int] = None
    alternative_role_ids: Optional[List[int]] = None
    required_resource_id: Optional[int] = None
    required_resource_type: Optional[str] = None
    required_resource_category: Optional[str] = None
    min_quantity: int = Field(default=1, ge=1)
    is_hard_stop: bool = False
    is_active: bool = True
    description: str
    duration_minutes: Optional[int] = Field(default=None, ge=1)
    start_offset_minutes: int = Field(default=0, ge=0)
    presence_type: Optional[str] = None
    active_weekdays: Optional[List[int]] = None
    active_start_time: Optional[str] = None
    active_end_time: Optional[str] = None
    clinic_id: Optional[int] = None

    @model_validator(mode="after")
    def at_least_one_constraint(self):
        has_role = self.required_role_id is not None or (
            self.alternative_role_ids and len(self.alternative_role_ids) > 0
        )
        has_resource = (
            self.required_resource_id is not None
            or self.required_resource_type is not None
            or self.required_resource_category is not None
        )
        if not has_role and not has_resource:
            raise ValueError(
                "A rule must constrain at least a role, resource, resource type, or category."
            )
        if self.required_resource_id is not None and (
            self.required_resource_type is not None or self.required_resource_category is not None
        ):
            raise ValueError(
                "Use either a specific resource_id or a resource type/category, not both."
            )
        if self.active_weekdays is not None:
            for d in self.active_weekdays:
                if d < 0 or d > 6:
                    raise ValueError("active_weekdays values must be integers 0–6 (Mon–Sun).")
        return self


class RuleUpdate(BaseModel):
    service_id: Optional[int] = None
    required_role_id: Optional[int] = None
    alternative_role_ids: Optional[List[int]] = None
    required_resource_id: Optional[int] = None
    required_resource_type: Optional[str] = None
    required_resource_category: Optional[str] = None
    min_quantity: Optional[int] = Field(default=None, ge=1)
    is_hard_stop: Optional[bool] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1)
    start_offset_minutes: Optional[int] = Field(default=None, ge=0)
    presence_type: Optional[str] = None
    active_weekdays: Optional[List[int]] = None
    active_start_time: Optional[str] = None
    active_end_time: Optional[str] = None
    clear_required_role_id: bool = False
    clear_alternative_role_ids: bool = False
    clear_required_resource_id: bool = False
    clear_required_resource_type: bool = False
    clear_required_resource_category: bool = False
    clear_duration_minutes: bool = False
    clear_presence_type: bool = False
    clear_active_weekdays: bool = False
    clear_active_start_time: bool = False
    clear_active_end_time: bool = False


class RuleOut(BaseModel):
    id: int
    clinic_id: int
    service_id: int
    required_role_id: Optional[int]
    alternative_role_ids: Optional[List[int]] = None
    required_resource_id: Optional[int]
    required_resource_type: Optional[str] = None
    required_resource_category: Optional[str] = None
    min_quantity: int = 1
    is_hard_stop: bool
    is_active: bool = True
    description: str
    duration_minutes: Optional[int] = None
    start_offset_minutes: int = 0
    presence_type: Optional[str] = None
    active_weekdays: Optional[List[int]] = None
    active_start_time: Optional[str] = None
    active_end_time: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Soft-stop / validation details ────────────────────────────────────────────

class ViolationDetail(BaseModel):
    rule_id: int
    description: str
    is_hard_stop: bool


class SoftStopResponse(BaseModel):
    detail: str = "soft_stop"
    violations: List[ViolationDetail]


# ── Booking ───────────────────────────────────────────────────────────────────

APPOINTMENT_STATUSES = ("scheduled", "completed", "cancelled", "no_show")


class AllocationIn(BaseModel):
    user_id: Optional[int] = None
    resource_id: Optional[int] = None
    presence_type: Optional[str] = None
    start_offset_minutes: int = Field(default=0, ge=0)
    duration_minutes: Optional[int] = Field(default=None, ge=1)

    @model_validator(mode="after")
    def exactly_one_set(self):
        if self.user_id is None and self.resource_id is None:
            raise ValueError("Each allocation must specify user_id or resource_id.")
        if self.user_id is not None and self.resource_id is not None:
            raise ValueError("Each allocation must specify only one of user_id or resource_id.")
        return self


class AppointmentCreate(BaseModel):
    clinic_id: Optional[int] = None
    service_id: int
    start_time: datetime
    # Prefer entity IDs; free-text names still accepted for find-or-create / legacy
    client_id: Optional[int] = None
    patient_id: Optional[int] = None
    client_name: Optional[str] = None
    patient_name: Optional[str] = None
    allocations: List[AllocationIn] = []
    override: bool = False
    overriding_user_id: Optional[int] = None
    override_double_booking: bool = False

    @model_validator(mode="after")
    def require_client_patient(self):
        if not self.client_id and not self.client_name:
            raise ValueError("Provide client_id or client_name.")
        if not self.patient_id and not self.patient_name:
            raise ValueError("Provide patient_id or patient_name.")
        return self


class AppointmentUpdate(BaseModel):
    service_id: Optional[int] = None
    start_time: Optional[datetime] = None
    client_id: Optional[int] = None
    patient_id: Optional[int] = None
    client_name: Optional[str] = None
    patient_name: Optional[str] = None
    status: Optional[str] = None
    allocations: Optional[List[AllocationIn]] = None
    override: bool = False
    overriding_user_id: Optional[int] = None
    override_double_booking: bool = False

    @model_validator(mode="after")
    def validate_status(self):
        if self.status is not None and self.status not in APPOINTMENT_STATUSES:
            raise ValueError(f"status must be one of {APPOINTMENT_STATUSES}")
        return self


class AppointmentValidateOut(BaseModel):
    valid: bool
    hard_violations: List[ViolationDetail] = []
    soft_violations: List[ViolationDetail] = []
    double_booking_conflicts: List[dict] = []


class AllocationOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    resource_id: Optional[int] = None
    presence_type: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    # Derived from appointment start for edit forms (not stored columns).
    start_offset_minutes: int = 0
    duration_minutes: Optional[int] = None

    model_config = {"from_attributes": True}

    @field_serializer("start_time", "end_time")
    def _ser_utc(self, v: Optional[datetime]) -> Optional[str]:
        from timeutil import as_utc_iso
        return as_utc_iso(v)


class AppointmentOut(BaseModel):
    id: int
    clinic_id: int
    service_id: int
    client_id: Optional[int] = None
    patient_id: Optional[int] = None
    start_time: datetime
    end_time: datetime
    client_name: str
    patient_name: str
    status: str
    allocations: List[AllocationOut] = []
    overrides: List["OverrideLogOut"] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by_user_id: Optional[int] = None
    updated_by_user_id: Optional[int] = None

    model_config = {"from_attributes": True}

    @field_serializer("start_time", "end_time", "created_at", "updated_at")
    def _ser_utc(self, v: Optional[datetime]) -> Optional[str]:
        from timeutil import as_utc_iso
        return as_utc_iso(v)


class AppointmentListOut(BaseModel):
    items: List[AppointmentOut]
    total: int
    limit: int
    offset: int


class OverrideLogOut(BaseModel):
    id: int
    appointment_id: int
    clinic_id: Optional[int] = None
    rule_id: Optional[int] = None
    override_type: str
    notes: Optional[str] = None
    timestamp: Optional[datetime] = None
    overridden_by_user_id: int
    authorizer_name: Optional[str] = None
    rule_description: Optional[str] = None
    client_name: Optional[str] = None
    patient_name: Optional[str] = None
    service_id: Optional[int] = None

    model_config = {"from_attributes": True}

    @field_serializer("timestamp")
    def _ser_ts(self, v: Optional[datetime]) -> Optional[str]:
        from timeutil import as_utc_iso
        return as_utc_iso(v)


class OverrideLogListOut(BaseModel):
    items: List[OverrideLogOut]
    total: int
    limit: int
    offset: int


# ── Schedule ──────────────────────────────────────────────────────────────────

class ScheduleEventOut(BaseModel):
    allocation_id: int
    appointment_id: int
    start_time: datetime
    end_time: datetime
    presence_type: Optional[str] = None
    client_name: str
    patient_name: str
    service_name: str
    status: Optional[str] = None

    @field_serializer("start_time", "end_time")
    def _ser_utc(self, v: Optional[datetime]) -> Optional[str]:
        from timeutil import as_utc_iso
        return as_utc_iso(v)

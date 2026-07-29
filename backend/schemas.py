from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, model_validator


# ── Auth ──────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


# ── Clinics ───────────────────────────────────────────────────────────────────

class ClinicOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


# ── Roles ────────────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    id: int
    name: str
    can_prescribe: bool

    model_config = {"from_attributes": True}


# ── Users ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    system_role: str = "USER"  # SYSTEM_ADMIN | CLINIC_ADMIN | USER
    role_id: Optional[int] = None
    # Only used when a SYSTEM_ADMIN creates a user for a specific clinic
    clinic_id: Optional[int] = None


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    system_role: str
    is_active: bool
    clinic_id: Optional[int]
    role: Optional[RoleOut]

    model_config = {"from_attributes": True}


# ── Resources ────────────────────────────────────────────────────────────────

class ResourceOut(BaseModel):
    id: int
    clinic_id: int
    name: str
    resource_type: str
    category: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Services ─────────────────────────────────────────────────────────────────

class ServiceOut(BaseModel):
    id: int
    clinic_id: int
    name: str
    default_duration_minutes: int

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
    presence_type: Optional[str] = None  # IN_ROOM | IN_BUILDING | REMOTE
    active_weekdays: Optional[List[int]] = None  # 0=Mon … 6=Sun
    active_start_time: Optional[str] = None  # "HH:MM"
    active_end_time: Optional[str] = None  # "HH:MM"
    # Only honoured when the caller is a SYSTEM_ADMIN
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
    # Explicit clear flags for nullable fields set via PATCH
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

class AllocationIn(BaseModel):
    user_id: Optional[int] = None
    resource_id: Optional[int] = None
    presence_type: Optional[str] = None  # IN_ROOM | IN_BUILDING | REMOTE
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
    clinic_id: Optional[int] = None  # required when current_user is SYSTEM_ADMIN
    service_id: int
    start_time: datetime
    client_name: str
    patient_name: str
    allocations: List[AllocationIn] = []
    override: bool = False
    overriding_user_id: Optional[int] = None
    override_double_booking: bool = False


class AppointmentValidateOut(BaseModel):
    valid: bool
    hard_violations: List[ViolationDetail] = []
    soft_violations: List[ViolationDetail] = []
    double_booking_conflicts: List[dict] = []


class AppointmentOut(BaseModel):
    id: int
    service_id: int
    start_time: datetime
    end_time: datetime
    client_name: str
    patient_name: str
    status: str

    model_config = {"from_attributes": True}


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

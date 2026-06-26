from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, model_validator


# ── Roles ────────────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    id: int
    name: str
    can_prescribe: bool

    model_config = {"from_attributes": True}


# ── Users ────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    name: str
    role: RoleOut
    is_active: bool

    model_config = {"from_attributes": True}


# ── Resources ────────────────────────────────────────────────────────────────

class ResourceOut(BaseModel):
    id: int
    name: str
    resource_type: str

    model_config = {"from_attributes": True}


# ── Services ─────────────────────────────────────────────────────────────────

class ServiceOut(BaseModel):
    id: int
    name: str
    default_duration_minutes: int

    model_config = {"from_attributes": True}


# ── Rules ────────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    service_id: int
    required_role_id: Optional[int] = None
    required_resource_id: Optional[int] = None
    is_hard_stop: bool = False
    description: str

    @model_validator(mode="after")
    def at_least_one_constraint(self):
        if self.required_role_id is None and self.required_resource_id is None:
            raise ValueError("A rule must constrain at least a role or a resource.")
        return self


class RuleOut(BaseModel):
    id: int
    service_id: int
    required_role_id: Optional[int]
    required_resource_id: Optional[int]
    is_hard_stop: bool
    description: str

    model_config = {"from_attributes": True}


# ── Booking ───────────────────────────────────────────────────────────────────

class AllocationIn(BaseModel):
    user_id: Optional[int] = None
    resource_id: Optional[int] = None

    @model_validator(mode="after")
    def exactly_one_set(self):
        if self.user_id is None and self.resource_id is None:
            raise ValueError("Each allocation must specify user_id or resource_id.")
        if self.user_id is not None and self.resource_id is not None:
            raise ValueError("Each allocation must specify only one of user_id or resource_id.")
        return self


class AppointmentCreate(BaseModel):
    service_id: int
    start_time: datetime
    client_name: str
    patient_name: str
    allocations: List[AllocationIn] = []
    override: bool = False
    # When override=True, the client must supply the user who is overriding
    overriding_user_id: Optional[int] = None


class AppointmentOut(BaseModel):
    id: int
    service_id: int
    start_time: datetime
    end_time: datetime
    client_name: str
    patient_name: str
    status: str

    model_config = {"from_attributes": True}


# ── Soft-stop response ────────────────────────────────────────────────────────

class ViolationDetail(BaseModel):
    rule_id: int
    description: str
    is_hard_stop: bool


class SoftStopResponse(BaseModel):
    detail: str = "soft_stop"
    violations: List[ViolationDetail]

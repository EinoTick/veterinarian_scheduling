from datetime import datetime
from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Clinic(Base):
    __tablename__ = "clinics"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)

    users = relationship("User", back_populates="clinic")
    resources = relationship("Resource", back_populates="clinic")
    services = relationship("Service", back_populates="clinic")
    rules = relationship("Rule", back_populates="clinic")
    appointments = relationship("Appointment", back_populates="clinic")


class Role(Base):
    """Clinical role — what job someone does (Vet, Tech, etc.)."""
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    can_prescribe = Column(Boolean, default=False)

    users = relationship("User", back_populates="role")
    rules = relationship("Rule", back_populates="required_role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    # SYSTEM_ADMIN | CLINIC_ADMIN | USER
    system_role = Column(String, nullable=False, default="USER")
    # nullable: SYSTEM_ADMIN is not tied to one clinic
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    # clinical role (Vet, Tech…); nullable for admin accounts
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    is_active = Column(Boolean, default=True)

    clinic = relationship("Clinic", back_populates="users")
    role = relationship("Role", back_populates="users")
    allocations = relationship("AppointmentAllocation", back_populates="user")
    override_logs = relationship("OverrideLog", back_populates="overridden_by_user")


class Resource(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    name = Column(String, nullable=False)
    # Broad kind: room | equipment
    resource_type = Column(String, nullable=False)
    # Narrower group for "any exam room" style rules: exam_room | dental_suite | …
    category = Column(String, nullable=True)

    clinic = relationship("Clinic", back_populates="resources")
    allocations = relationship("AppointmentAllocation", back_populates="resource")
    rules = relationship("Rule", back_populates="required_resource")


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("clinic_id", "name", name="uq_service_clinic_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    name = Column(String, nullable=False)
    default_duration_minutes = Column(Integer, nullable=False, default=30)

    clinic = relationship("Clinic", back_populates="services")
    appointments = relationship("Appointment", back_populates="service")
    rules = relationship("Rule", back_populates="service")


class Rule(Base):
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    required_role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    # Additional roles that also satisfy the role constraint (OR with required_role_id)
    alternative_role_ids = Column(JSON, nullable=True)  # e.g. [2, 3]
    required_resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True)
    # Match any resource of this broad type ("room") or narrow category ("exam_room")
    required_resource_type = Column(String, nullable=True)
    required_resource_category = Column(String, nullable=True)
    # How many matching allocations are required (e.g. 2 techs)
    min_quantity = Column(Integer, nullable=False, default=1)
    is_hard_stop = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, nullable=False)
    description = Column(String, nullable=False)
    # Timing window the matching allocation must cover within the appointment
    duration_minutes = Column(Integer, nullable=True)
    start_offset_minutes = Column(Integer, nullable=False, default=0)
    presence_type = Column(String, nullable=True)  # IN_ROOM | IN_BUILDING | REMOTE
    # Day/time scope — rule only applies when appointment starts in this window
    active_weekdays = Column(JSON, nullable=True)  # [0..6] Mon=0; null = every day
    active_start_time = Column(String, nullable=True)  # "HH:MM"; null = no lower bound
    active_end_time = Column(String, nullable=True)  # "HH:MM"; null = no upper bound

    clinic = relationship("Clinic", back_populates="rules")
    service = relationship("Service", back_populates="rules")
    required_role = relationship("Role", back_populates="rules")
    required_resource = relationship("Resource", back_populates="rules")
    override_logs = relationship("OverrideLog", back_populates="rule")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    client_name = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    status = Column(String, default="scheduled")

    clinic = relationship("Clinic", back_populates="appointments")
    service = relationship("Service", back_populates="appointments")
    allocations = relationship(
        "AppointmentAllocation", back_populates="appointment", cascade="all, delete-orphan"
    )
    override_logs = relationship(
        "OverrideLog", back_populates="appointment", cascade="all, delete-orphan"
    )


class AppointmentAllocation(Base):
    __tablename__ = "appointment_allocations"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    presence_type = Column(String, nullable=True)  # IN_ROOM | IN_BUILDING | REMOTE

    appointment = relationship("Appointment", back_populates="allocations")
    user = relationship("User", back_populates="allocations")
    resource = relationship("Resource", back_populates="allocations")


class OverrideLog(Base):
    __tablename__ = "override_logs"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    rule_id = Column(Integer, ForeignKey("rules.id"), nullable=False)
    overridden_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

    appointment = relationship("Appointment", back_populates="override_logs")
    rule = relationship("Rule", back_populates="override_logs")
    overridden_by_user = relationship("User", back_populates="override_logs")

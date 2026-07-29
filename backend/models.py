from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AuditMixin(TimestampMixin):
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class Clinic(Base, TimestampMixin):
    __tablename__ = "clinics"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)

    users = relationship("User", back_populates="clinic", foreign_keys="User.clinic_id")
    resources = relationship("Resource", back_populates="clinic")
    services = relationship("Service", back_populates="clinic")
    rules = relationship("Rule", back_populates="clinic")
    appointments = relationship("Appointment", back_populates="clinic")
    clients = relationship("Client", back_populates="clinic")
    roles = relationship("Role", back_populates="clinic")


class Role(Base, TimestampMixin):
    """
    Clinical role — what job someone does (Vet, Tech, etc.).

    Two-tier model:
    - clinic_id IS NULL  → global catalog role (shared)
    - clinic_id set      → clinic-specific role (e.g. "Groomer")
    """
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    name = Column(String, nullable=False)
    can_prescribe = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, nullable=False)

    clinic = relationship("Clinic", back_populates="roles")
    users = relationship("User", back_populates="role", foreign_keys="User.role_id")
    rules = relationship("Rule", back_populates="required_role")


class User(Base, TimestampMixin):
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
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    clinic = relationship("Clinic", back_populates="users", foreign_keys=[clinic_id])
    role = relationship("Role", back_populates="users", foreign_keys=[role_id])
    allocations = relationship("AppointmentAllocation", back_populates="user")
    override_logs = relationship(
        "OverrideLog", back_populates="overridden_by_user", foreign_keys="OverrideLog.overridden_by_user_id"
    )


class Resource(Base, AuditMixin):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    name = Column(String, nullable=False)
    # Broad kind: room | equipment
    resource_type = Column(String, nullable=False)
    # Narrower group: exam_room | dental_suite | …
    category = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    clinic = relationship("Clinic", back_populates="resources")
    allocations = relationship("AppointmentAllocation", back_populates="resource")
    rules = relationship("Rule", back_populates="required_resource")


class Service(Base, AuditMixin):
    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("clinic_id", "name", name="uq_service_clinic_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    name = Column(String, nullable=False)
    default_duration_minutes = Column(Integer, nullable=False, default=30)
    is_active = Column(Boolean, default=True, nullable=False)

    clinic = relationship("Clinic", back_populates="services")
    appointments = relationship("Appointment", back_populates="service")
    rules = relationship("Rule", back_populates="service")


class Client(Base, AuditMixin):
    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("clinic_id", "name", "email", name="uq_client_clinic_name_email"),
    )

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    clinic = relationship("Clinic", back_populates="clients")
    patients = relationship("Patient", back_populates="client", cascade="all, delete-orphan")
    appointments = relationship("Appointment", back_populates="client")


class Patient(Base, AuditMixin):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    name = Column(String, nullable=False)
    species = Column(String, nullable=True)  # Dog, Cat, …
    breed = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    client = relationship("Client", back_populates="patients")
    appointments = relationship("Appointment", back_populates="patient")


class Rule(Base, AuditMixin):
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    required_role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    alternative_role_ids = Column(JSON, nullable=True)
    required_resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True)
    required_resource_type = Column(String, nullable=True)
    required_resource_category = Column(String, nullable=True)
    min_quantity = Column(Integer, nullable=False, default=1)
    is_hard_stop = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, nullable=False)
    description = Column(String, nullable=False)
    duration_minutes = Column(Integer, nullable=True)
    start_offset_minutes = Column(Integer, nullable=False, default=0)
    presence_type = Column(String, nullable=True)
    active_weekdays = Column(JSON, nullable=True)
    active_start_time = Column(String, nullable=True)
    active_end_time = Column(String, nullable=True)

    clinic = relationship("Clinic", back_populates="rules")
    service = relationship("Service", back_populates="rules")
    required_role = relationship("Role", back_populates="rules")
    required_resource = relationship("Resource", back_populates="rules")
    override_logs = relationship("OverrideLog", back_populates="rule")


class Appointment(Base, AuditMixin):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    # Snapshot names preserved for history even if client/patient records change
    client_name = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    # scheduled | completed | cancelled | no_show
    status = Column(String, default="scheduled", nullable=False)

    clinic = relationship("Clinic", back_populates="appointments")
    service = relationship("Service", back_populates="appointments")
    client = relationship("Client", back_populates="appointments")
    patient = relationship("Patient", back_populates="appointments")
    allocations = relationship(
        "AppointmentAllocation", back_populates="appointment", cascade="all, delete-orphan"
    )
    override_logs = relationship(
        "OverrideLog", back_populates="appointment", cascade="all, delete-orphan"
    )


class AppointmentAllocation(Base, TimestampMixin):
    __tablename__ = "appointment_allocations"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    presence_type = Column(String, nullable=True)

    appointment = relationship("Appointment", back_populates="allocations")
    user = relationship("User", back_populates="allocations")
    resource = relationship("Resource", back_populates="allocations")


class OverrideLog(Base):
    """
    Audit trail for booking overrides.

    override_type:
      - soft_stop: rule soft-stop was overridden (rule_id set)
      - double_booking: overlapping allocation was overridden (rule_id null)
    """
    __tablename__ = "override_logs"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    rule_id = Column(Integer, ForeignKey("rules.id"), nullable=True)
    overridden_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    override_type = Column(String, nullable=False, default="soft_stop")
    notes = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    appointment = relationship("Appointment", back_populates="override_logs")
    rule = relationship("Rule", back_populates="override_logs")
    overridden_by_user = relationship(
        "User", back_populates="override_logs", foreign_keys=[overridden_by_user_id]
    )

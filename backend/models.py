from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Role(Base):
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
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    is_active = Column(Boolean, default=True)

    role = relationship("Role", back_populates="users")
    allocations = relationship("AppointmentAllocation", back_populates="user")
    override_logs = relationship("OverrideLog", back_populates="overridden_by_user")


class Resource(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)

    allocations = relationship("AppointmentAllocation", back_populates="resource")
    rules = relationship("Rule", back_populates="required_resource")


class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    default_duration_minutes = Column(Integer, nullable=False, default=30)

    appointments = relationship("Appointment", back_populates="service")
    rules = relationship("Rule", back_populates="service")


class Rule(Base):
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    required_role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    required_resource_id = Column(Integer, ForeignKey("resources.id"), nullable=True)
    is_hard_stop = Column(Boolean, default=False)
    description = Column(String, nullable=False)

    service = relationship("Service", back_populates="rules")
    required_role = relationship("Role", back_populates="rules")
    required_resource = relationship("Resource", back_populates="rules")
    override_logs = relationship("OverrideLog", back_populates="rule")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    client_name = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    status = Column(String, default="scheduled")

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



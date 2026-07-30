"""Serialize appointments / allocations / override logs for API responses."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from models import Appointment, AppointmentAllocation, OverrideLog
from schemas import AllocationOut, AppointmentOut, OverrideLogOut


def allocation_out(alloc: AppointmentAllocation, appt_start: datetime) -> AllocationOut:
    offset = 0
    duration = None
    if alloc.start_time is not None and appt_start is not None:
        offset = max(0, int((alloc.start_time - appt_start).total_seconds() // 60))
    if alloc.start_time is not None and alloc.end_time is not None:
        duration = max(1, int((alloc.end_time - alloc.start_time).total_seconds() // 60))
    return AllocationOut(
        id=alloc.id,
        user_id=alloc.user_id,
        resource_id=alloc.resource_id,
        presence_type=alloc.presence_type,
        start_time=alloc.start_time,
        end_time=alloc.end_time,
        start_offset_minutes=offset,
        duration_minutes=duration,
    )


def override_log_out(log: OverrideLog) -> OverrideLogOut:
    appt = log.appointment
    authorizer = log.overridden_by_user
    rule = log.rule
    return OverrideLogOut(
        id=log.id,
        appointment_id=log.appointment_id,
        clinic_id=appt.clinic_id if appt else None,
        rule_id=log.rule_id,
        override_type=log.override_type,
        notes=log.notes,
        timestamp=log.timestamp,
        overridden_by_user_id=log.overridden_by_user_id,
        authorizer_name=authorizer.name if authorizer else None,
        rule_description=rule.description if rule else None,
        client_name=appt.client_name if appt else None,
        patient_name=appt.patient_name if appt else None,
        service_id=appt.service_id if appt else None,
    )


def appointment_out(appt: Appointment) -> AppointmentOut:
    # Avoid lazy N+1 on list endpoints that do not eager-load override_logs.
    overrides = []
    if "override_logs" in appt.__dict__:
        overrides = [override_log_out(o) for o in (appt.override_logs or [])]
    return AppointmentOut(
        id=appt.id,
        clinic_id=appt.clinic_id,
        service_id=appt.service_id,
        client_id=appt.client_id,
        patient_id=appt.patient_id,
        start_time=appt.start_time,
        end_time=appt.end_time,
        client_name=appt.client_name,
        patient_name=appt.patient_name,
        status=appt.status,
        allocations=[
            allocation_out(a, appt.start_time) for a in (appt.allocations or [])
        ],
        overrides=overrides,
        created_at=appt.created_at,
        updated_at=appt.updated_at,
        created_by_user_id=appt.created_by_user_id,
        updated_by_user_id=appt.updated_by_user_id,
    )


def load_appointment(db: Session, appointment_id: int) -> Optional[Appointment]:
    return (
        db.query(Appointment)
        .options(
            joinedload(Appointment.allocations),
            joinedload(Appointment.override_logs).joinedload(OverrideLog.overridden_by_user),
            joinedload(Appointment.override_logs).joinedload(OverrideLog.rule),
        )
        .filter(Appointment.id == appointment_id)
        .first()
    )

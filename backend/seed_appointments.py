#!/usr/bin/env python3
"""
seed_appointments.py
Generate realistic mock appointment data for testing calendar views.

Run from the backend/ directory after the FastAPI app has been started at
least once (so the DB tables and demo clinic exist):

    pip install faker
    python seed_appointments.py              # 25 appointments per clinic
    python seed_appointments.py --count 40  # custom count
    python seed_appointments.py --clear     # wipe existing appointments first
"""

import argparse
import random
import sys
from datetime import datetime, timedelta

from faker import Faker
from sqlalchemy.orm import Session

sys.path.insert(0, ".")
from database import SessionLocal
from models import (
    Appointment, AppointmentAllocation, Clinic, OverrideLog,
    Resource, Rule, Service, User,
)

fake = Faker()
Faker.seed(0)
random.seed(0)

PRESENCE_TYPES = ["IN_ROOM", "IN_BUILDING", "REMOTE"]
PET_SUFFIXES = ["(Dog)", "(Cat)", "(Rabbit)", "(Bird)", "(Guinea Pig)", "(Ferret)"]
DELIBERATE_DOUBLE_BOOKINGS = 3   # per clinic


# ── Time helpers ──────────────────────────────────────────────────────────────

def week_days() -> list:
    """Monday–Friday of the current calendar week."""
    today = datetime.now().date()
    monday = today - timedelta(days=today.weekday())
    return [monday + timedelta(days=i) for i in range(5)]


def random_slot(date, service_duration: int) -> datetime:
    """
    Random 15-minute-aligned start time between 08:00 and 17:00,
    guaranteed to end no later than 18:00.
    """
    earliest = 8 * 60                          # 08:00
    latest = 17 * 60 - service_duration        # must end by 17:00 + grace
    latest = max(earliest, min(latest, 16 * 60))
    choices = list(range(earliest, latest + 1, 15))
    start_min = random.choice(choices)
    return datetime(date.year, date.month, date.day,
                    start_min // 60, start_min % 60)


def alloc_window(appt_start: datetime, service_duration: int, full: bool = False):
    """
    Return (alloc_start, alloc_end) for one allocation.

    full=True  → occupies the entire appointment window (offset 0).
    full=False → 40% chance of full window, otherwise a realistic partial slice.
    """
    if full or service_duration < 20 or random.random() < 0.40:
        offset, duration = 0, service_duration
    else:
        # Pick an offset that still leaves at least 10 minutes
        candidates = [o for o in (0, 5, 10, 15, 20) if o <= service_duration - 10]
        offset = random.choice(candidates) if candidates else 0
        remaining = service_duration - offset
        min_dur = max(10, remaining // 2)
        dur_choices = list(range(min_dur, remaining + 1, 5)) or [remaining]
        duration = random.choice(dur_choices)

    start = appt_start + timedelta(minutes=offset)
    end = start + timedelta(minutes=duration)
    return start, end


# ── Core seeder ───────────────────────────────────────────────────────────────

def seed_clinic(db: Session, clinic: Clinic, count: int) -> int:
    """
    Seed `count` appointments for one clinic.
    Returns the number of appointments created.
    """
    # Limit to clinical staff (role_id set, not pure admin accounts)
    staff = [u for u in clinic.users
             if u.role_id is not None and u.is_active]
    resources = list(clinic.resources)
    services   = list(clinic.services)
    rules      = list(clinic.rules)

    if not staff:
        print(f"  [SKIP] {clinic.name} — no active clinical staff found")
        return 0
    if not resources:
        print(f"  [SKIP] {clinic.name} — no resources found")
        return 0
    if not services:
        print(f"  [SKIP] {clinic.name} — no services found")
        return 0

    # Prefer soft-stop rules for override logs (more realistic).
    # Fall back to any rule if none are soft; skip override logs if no rules at all.
    soft_rules = [r for r in rules if not r.is_hard_stop]
    override_rule: Rule | None = (soft_rules or rules or [None])[0]

    authorizer = next(
        (u for u in clinic.users if u.system_role == "CLINIC_ADMIN"),
        staff[0],
    )

    days = week_days()
    created: list[Appointment] = []

    # ── Normal appointments ───────────────────────────────────────────────────
    for _ in range(count):
        service = random.choice(services)
        date    = random.choice(days)
        start   = random_slot(date, service.default_duration_minutes)
        end     = start + timedelta(minutes=service.default_duration_minutes)

        appt = Appointment(
            clinic_id    = clinic.id,
            service_id   = service.id,
            start_time   = start,
            end_time     = end,
            client_name  = fake.last_name() + " Family",
            patient_name = fake.first_name() + " " + random.choice(PET_SUFFIXES),
            status       = "scheduled",
        )
        db.add(appt)
        db.flush()

        # ── Staff allocations ─────────────────────────────────────────────
        # First staff member occupies the full appointment window (primary clinician).
        # Optional second member gets a partial window and varied presence type.
        n_staff = min(random.choices([1, 2], weights=[55, 45])[0], len(staff))
        for i, user in enumerate(random.sample(staff, k=n_staff)):
            a_start, a_end = alloc_window(
                start, service.default_duration_minutes, full=(i == 0)
            )
            db.add(AppointmentAllocation(
                appointment_id = appt.id,
                user_id        = user.id,
                start_time     = a_start,
                end_time       = a_end,
                presence_type  = "IN_ROOM" if i == 0 else random.choice(PRESENCE_TYPES),
            ))

        # ── Resource allocations ──────────────────────────────────────────
        # Resources sometimes start a few minutes in (setup / prep time).
        # A second resource (e.g. X-Ray after the exam room) is less common.
        n_res = min(random.choices([1, 2], weights=[70, 30])[0], len(resources))
        for j, resource in enumerate(random.sample(resources, k=n_res)):
            # First resource: 50 % chance of full window; second always partial
            a_start, a_end = alloc_window(
                start, service.default_duration_minutes,
                full=(j == 0 and random.random() < 0.50),
            )
            db.add(AppointmentAllocation(
                appointment_id = appt.id,
                resource_id    = resource.id,
                start_time     = a_start,
                end_time       = a_end,
                presence_type  = None,
            ))

        created.append(appt)

    db.flush()

    # ── Deliberate double-bookings ────────────────────────────────────────────
    # Strategy: pick N existing appointments as "base". For each, create a
    # second appointment that starts at the same time. Allocate the same staff
    # member to both, then write an OverrideLog recording the intentional conflict.
    if override_rule is None:
        print(f"  [INFO] No rules found for {clinic.name} — skipping override logs")
    elif len(created) >= DELIBERATE_DOUBLE_BOOKINGS:
        dupe_staff = random.choice(staff)           # the "overbooked" clinician
        base_appts = random.sample(created, k=DELIBERATE_DOUBLE_BOOKINGS)

        print(f"  Creating {DELIBERATE_DOUBLE_BOOKINGS} deliberate double-bookings "
              f"for {dupe_staff.name}…")

        for base in base_appts:
            # Ensure dupe_staff is allocated to the base appointment so the
            # conflict is unambiguous in the calendar.
            db.add(AppointmentAllocation(
                appointment_id = base.id,
                user_id        = dupe_staff.id,
                start_time     = base.start_time,
                end_time       = base.end_time,
                presence_type  = "IN_ROOM",
            ))

            # Create the colliding appointment — same day, overlapping slot.
            clash_service = random.choice(services)
            clash_offset  = random.choice([0, 15, 30])   # minutes into base appt
            clash_start   = base.start_time + timedelta(minutes=clash_offset)
            clash_end     = clash_start + timedelta(
                minutes=clash_service.default_duration_minutes
            )

            clash_appt = Appointment(
                clinic_id    = clinic.id,
                service_id   = clash_service.id,
                start_time   = clash_start,
                end_time     = clash_end,
                client_name  = fake.last_name() + " Family",
                patient_name = fake.first_name() + " " + random.choice(PET_SUFFIXES),
                status       = "scheduled",
            )
            db.add(clash_appt)
            db.flush()

            # Allocate the SAME staff member to the clashing appointment
            db.add(AppointmentAllocation(
                appointment_id = clash_appt.id,
                user_id        = dupe_staff.id,
                start_time     = clash_start,
                end_time       = clash_end,
                presence_type  = random.choice(PRESENCE_TYPES),
            ))

            # Give the clash appointment a resource too
            db.add(AppointmentAllocation(
                appointment_id = clash_appt.id,
                resource_id    = random.choice(resources).id,
                start_time     = clash_start,
                end_time       = clash_end,
                presence_type  = None,
            ))

            # Override log: the manager forced this through the soft stop
            db.add(OverrideLog(
                appointment_id       = clash_appt.id,
                rule_id              = override_rule.id,
                overridden_by_user_id = authorizer.id,
                timestamp            = clash_start - timedelta(
                    minutes=random.randint(2, 30)
                ),
            ))

            created.append(clash_appt)

    return len(created)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Seed appointment data for the VetClinic Scheduler."
    )
    parser.add_argument(
        "--count", type=int, default=25,
        help="Number of normal appointments to generate per clinic (default: 25).",
    )
    parser.add_argument(
        "--clear", action="store_true",
        help="Delete ALL existing appointments (and their allocations / override logs) "
             "before seeding. Useful for a clean slate.",
    )
    args = parser.parse_args()

    db: Session = SessionLocal()
    try:
        clinics = db.query(Clinic).all()
        if not clinics:
            print(
                "No clinics found in the database.\n"
                "Start the FastAPI app once first so it can run its startup seed,\n"
                "then re-run this script."
            )
            sys.exit(1)

        if args.clear:
            n_logs   = db.query(OverrideLog).delete()
            n_allocs = db.query(AppointmentAllocation).delete()
            n_appts  = db.query(Appointment).delete()
            db.flush()
            print(
                f"Cleared {n_appts} appointment(s), "
                f"{n_allocs} allocation(s), "
                f"{n_logs} override log(s).\n"
            )

        grand_total = 0
        for clinic in clinics:
            # Touch the lazy-loaded collections while the session is open
            _ = clinic.users, clinic.resources, clinic.services, clinic.rules

            print(f"[{clinic.name}]")
            n = seed_clinic(db, clinic, args.count)
            grand_total += n
            print(f"  {n} appointment(s) created.\n")

        db.commit()
        print(
            f"Done. {grand_total} total appointment(s) seeded "
            f"across {len(clinics)} clinic(s)."
        )

    except Exception as exc:
        db.rollback()
        print(f"\nERROR — transaction rolled back.\n{exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()

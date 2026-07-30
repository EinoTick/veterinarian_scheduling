"""Consolidate the legacy ad-hoc run_migrations() statements into a tracked revision.

Previously these ran as an untracked raw-SQL list on every app startup
(main.py's run_migrations()), with per-statement try/except-and-continue —
no version tracking, and a failure in one statement wouldn't stop the rest
or surface clearly. All statements here are unchanged and still idempotent
(IF NOT EXISTS / IF EXISTS), so this is a no-op against a database that
already received them via the old path — but now it's tracked like any
other schema change, and a genuine failure aborts the migration (and thus
app startup) instead of being silently logged and skipped.

Revision ID: 002_legacy_baseline
Revises: 001_indexes_tz
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "002_legacy_baseline"
down_revision: Union[str, None] = "001_indexes_tz"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATEMENTS = [
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS duration_minutes INTEGER",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS start_offset_minutes INTEGER DEFAULT 0",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS presence_type VARCHAR",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS alternative_role_ids JSON",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS required_resource_type VARCHAR",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS required_resource_category VARCHAR",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS min_quantity INTEGER DEFAULT 1",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_weekdays JSON",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_start_time VARCHAR",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS active_end_time VARCHAR",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE rules ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS category VARCHAR",
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
    "ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE services ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
    "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS start_time TIMESTAMP",
    "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS end_time TIMESTAMP",
    "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS presence_type VARCHAR",
    "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE appointment_allocations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_id INTEGER",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
    "ALTER TABLE clinics ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE clinics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS clinic_id INTEGER",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "ALTER TABLE override_logs ALTER COLUMN rule_id DROP NOT NULL",
    "ALTER TABLE override_logs ADD COLUMN IF NOT EXISTS override_type VARCHAR DEFAULT 'soft_stop'",
    "ALTER TABLE override_logs ADD COLUMN IF NOT EXISTS notes VARCHAR",
    # Drop global unique on roles.name if present (name is now scoped)
    "ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key",
    # Clients / patients tables predate the Client/Patient ORM models on some
    # older databases; ensure they exist with the expected FKs.
    """
    CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        clinic_id INTEGER NOT NULL REFERENCES clinics(id),
        name VARCHAR NOT NULL,
        email VARCHAR,
        phone VARCHAR,
        notes VARCHAR,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        created_by_user_id INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        clinic_id INTEGER NOT NULL REFERENCES clinics(id),
        client_id INTEGER NOT NULL REFERENCES clients(id),
        name VARCHAR NOT NULL,
        species VARCHAR,
        breed VARCHAR,
        notes VARCHAR,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        created_by_user_id INTEGER
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_global_name ON roles (name) WHERE clinic_id IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_clinic_name ON roles (clinic_id, name) WHERE clinic_id IS NOT NULL",
    "UPDATE resources SET category = 'dental_suite' WHERE name LIKE 'Dental Suite%' AND category IS NULL",
    "UPDATE resources SET category = 'surgery_suite' WHERE name LIKE 'Surgery Suite%' AND category IS NULL",
    "UPDATE resources SET category = 'exam_room' WHERE name LIKE 'Exam Room%' AND category IS NULL",
    "UPDATE resources SET category = 'imaging' WHERE name LIKE 'X-Ray%' AND category IS NULL",
    "UPDATE rules SET is_active = TRUE WHERE is_active IS NULL",
    "UPDATE rules SET min_quantity = 1 WHERE min_quantity IS NULL",
    "UPDATE resources SET is_active = TRUE WHERE is_active IS NULL",
    "UPDATE services SET is_active = TRUE WHERE is_active IS NULL",
    "UPDATE roles SET is_active = TRUE WHERE is_active IS NULL",
    "UPDATE override_logs SET override_type = 'soft_stop' WHERE override_type IS NULL",
    "UPDATE appointments SET status = 'scheduled' WHERE status IS NULL",
]


def upgrade() -> None:
    for stmt in _STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # These are additive/idempotent backfills with no clean single-column
    # rollback story (several columns are also owned by the ORM models
    # directly). Not supporting downgrade here matches 001's precedent of
    # not reversing additive changes that later code depends on.
    pass

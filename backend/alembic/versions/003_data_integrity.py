"""Data integrity fixes: NULL-email client dedup, end>start checks, case-insensitive role names.

- clients' (clinic_id, name, email) unique constraint doesn't catch
  duplicates when email is NULL (Postgres treats NULL as distinct in unique
  constraints) — add a partial unique index covering that case.
- Nothing previously stopped an inverted/zero-length appointment or
  allocation window from being written directly — add CHECK constraints.
- Role name uniqueness was case/whitespace sensitive ("Vet" and "vet" could
  coexist in the same scope) — replace the two partial unique indexes with
  expression-based (lower(name)) equivalents. (Trimming whitespace on write
  is handled in application code, not here.)

Revision ID: 003_data_integrity
Revises: 002_legacy_baseline
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "003_data_integrity"
down_revision: Union[str, None] = "002_legacy_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_client_clinic_name_null_email "
        "ON clients (clinic_id, name) WHERE email IS NULL"
    )

    op.execute(
        "ALTER TABLE appointments ADD CONSTRAINT chk_appointments_end_after_start "
        "CHECK (end_time > start_time)"
    )
    op.execute(
        "ALTER TABLE appointment_allocations ADD CONSTRAINT chk_alloc_end_after_start "
        "CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time)"
    )

    op.execute("DROP INDEX IF EXISTS uq_roles_global_name")
    op.execute("DROP INDEX IF EXISTS uq_roles_clinic_name")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_global_name "
        "ON roles (lower(name)) WHERE clinic_id IS NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_clinic_name "
        "ON roles (clinic_id, lower(name)) WHERE clinic_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_roles_clinic_name")
    op.execute("DROP INDEX IF EXISTS uq_roles_global_name")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_global_name "
        "ON roles (name) WHERE clinic_id IS NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_clinic_name "
        "ON roles (clinic_id, name) WHERE clinic_id IS NOT NULL"
    )
    op.execute("ALTER TABLE appointment_allocations DROP CONSTRAINT IF EXISTS chk_alloc_end_after_start")
    op.execute("ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_appointments_end_after_start")
    op.execute("DROP INDEX IF EXISTS uq_client_clinic_name_null_email")

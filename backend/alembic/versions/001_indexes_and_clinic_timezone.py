"""Add allocation/appointment indexes and clinic.timezone.

Revision ID: 001_indexes_tz
Revises:
Create Date: 2026-07-29
"""
from typing import Sequence, Union

from alembic import op

revision: str = "001_indexes_tz"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent DDL so this is safe on DBs that already received ad-hoc ALTERs.
    op.execute("ALTER TABLE clinics ADD COLUMN IF NOT EXISTS timezone VARCHAR DEFAULT 'UTC'")
    op.execute("UPDATE clinics SET timezone = 'UTC' WHERE timezone IS NULL")
    op.execute("ALTER TABLE clinics ALTER COLUMN timezone SET DEFAULT 'UTC'")
    op.execute("ALTER TABLE clinics ALTER COLUMN timezone SET NOT NULL")

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alloc_user_start_end "
        "ON appointment_allocations (user_id, start_time, end_time)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alloc_resource_start_end "
        "ON appointment_allocations (resource_id, start_time, end_time)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alloc_appointment_id "
        "ON appointment_allocations (appointment_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_appointments_clinic_start "
        "ON appointments (clinic_id, start_time)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_appointments_clinic_start")
    op.execute("DROP INDEX IF EXISTS ix_alloc_appointment_id")
    op.execute("DROP INDEX IF EXISTS ix_alloc_resource_start_end")
    op.execute("DROP INDEX IF EXISTS ix_alloc_user_start_end")
    # Keep timezone column on downgrade — dropping it could destroy operator config.

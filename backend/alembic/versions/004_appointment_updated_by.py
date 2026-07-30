"""Add appointments.updated_by_user_id.

Tracks who last touched an appointment (create/reschedule/status
change/cancel) — created_by_user_id (from AuditMixin) never changes after
creation. Set in main.py's create_appointment/update_appointment/
cancel_appointment.

Revision ID: 004_appointment_updated_by
Revises: 003_data_integrity
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "004_appointment_updated_by"
down_revision: Union[str, None] = "003_data_integrity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_by_user_id "
        "INTEGER REFERENCES users(id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE appointments DROP COLUMN IF EXISTS updated_by_user_id")

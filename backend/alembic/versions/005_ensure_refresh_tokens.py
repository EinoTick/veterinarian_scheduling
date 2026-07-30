"""Ensure refresh_tokens exists on databases stamped before the schema baseline.

Existing environments that created tables via SQLAlchemy ``create_all`` and
were stamped at 001–004 never ran ``000_schema_baseline``. After ``create_all``
is removed, those DBs still need ``refresh_tokens`` if it was somehow missing.
Idempotent CREATE IF NOT EXISTS — no-op when the baseline (or create_all)
already created the table.

Revision ID: 005_ensure_refresh_tokens
Revises: 004_appointment_updated_by
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "005_ensure_refresh_tokens"
down_revision: Union[str, None] = "004_appointment_updated_by"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            revoked_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            user_agent VARCHAR
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens (user_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_refresh_tokens_token_hash "
        "ON refresh_tokens (token_hash)"
    )


def downgrade() -> None:
    # Do not drop — sessions depend on this table; baseline owns lifecycle.
    pass

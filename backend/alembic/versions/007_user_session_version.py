"""Add users.session_version for immediate access-token invalidation.

Revision ID: 007_user_session_version
Revises: 006_refresh_tokens_cascade
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "007_user_session_version"
down_revision: Union[str, None] = "006_refresh_tokens_cascade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version "
        "INTEGER NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS session_version")

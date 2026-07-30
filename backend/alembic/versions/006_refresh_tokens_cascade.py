"""Align refresh_tokens.user_id FK to ON DELETE CASCADE.

Legacy ``create_all`` / early 005 creates used a plain REFERENCES without
CASCADE. The ORM relationship is delete-orphan; DB-level CASCADE keeps raw
SQL and bulk user deletes consistent. Idempotent: drops any existing
user_id FK on refresh_tokens and re-adds it with CASCADE.

Revision ID: 006_refresh_tokens_cascade
Revises: 005_ensure_refresh_tokens
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "006_refresh_tokens_cascade"
down_revision: Union[str, None] = "005_ensure_refresh_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Constraint name varies (create_all vs explicit). Drop by column lookup.
    op.execute(
        """
        DO $$
        DECLARE
            con_name text;
        BEGIN
            SELECT c.conname INTO con_name
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'refresh_tokens'
              AND c.contype = 'f'
              AND pg_get_constraintdef(c.oid) LIKE '%user_id%';

            IF con_name IS NOT NULL THEN
                EXECUTE format(
                    'ALTER TABLE refresh_tokens DROP CONSTRAINT %I',
                    con_name
                );
            END IF;

            ALTER TABLE refresh_tokens
                ADD CONSTRAINT refresh_tokens_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        EXCEPTION
            WHEN undefined_table THEN NULL;
            WHEN duplicate_object THEN NULL;
        END $$
        """
    )


def downgrade() -> None:
    # Keep CASCADE — safer default; no reason to weaken on downgrade.
    pass

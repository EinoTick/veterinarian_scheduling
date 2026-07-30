"""Create the full application schema (Alembic-owned baseline).

This is the greenfield root: an empty database can reach a usable schema by
running ``alembic upgrade head`` alone — no SQLAlchemy ``create_all``.

All statements are idempotent (IF NOT EXISTS) so a database that already has
tables from a legacy ``create_all`` path can still run this revision if it is
ever applied (e.g. stamp/repair workflows). Normal upgrades from an already-
stamped head (001+) do not re-run this revision.

Integrity CHECKs and case-insensitive role uniqueness land in later
revisions (003+) so the historical upgrade path stays intact.

Revision ID: 000_schema_baseline
Revises:
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "000_schema_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Order respects foreign keys. Timestamps are naive UTC (app contract).
    # PRIMARY KEY already indexes id — no redundant ix_<table>_id indexes.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS clinics (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL,
            timezone VARCHAR NOT NULL DEFAULT 'UTC',
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS roles (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER REFERENCES clinics(id),
            name VARCHAR NOT NULL,
            can_prescribe BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL,
            email VARCHAR NOT NULL,
            hashed_password VARCHAR NOT NULL,
            system_role VARCHAR NOT NULL DEFAULT 'USER',
            clinic_id INTEGER REFERENCES clinics(id),
            role_id INTEGER REFERENCES roles(id),
            is_active BOOLEAN DEFAULT TRUE,
            created_by_user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")

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

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS resources (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            name VARCHAR NOT NULL,
            resource_type VARCHAR NOT NULL,
            category VARCHAR,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS services (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            name VARCHAR NOT NULL,
            default_duration_minutes INTEGER NOT NULL DEFAULT 30,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id),
            CONSTRAINT uq_service_clinic_name UNIQUE (clinic_id, name)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS clients (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            name VARCHAR NOT NULL,
            email VARCHAR,
            phone VARCHAR,
            notes VARCHAR,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id),
            CONSTRAINT uq_client_clinic_name_email UNIQUE (clinic_id, name, email)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            client_id INTEGER NOT NULL REFERENCES clients(id),
            name VARCHAR NOT NULL,
            species VARCHAR,
            breed VARCHAR,
            notes VARCHAR,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rules (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            service_id INTEGER NOT NULL REFERENCES services(id),
            required_role_id INTEGER REFERENCES roles(id),
            alternative_role_ids JSON,
            required_resource_id INTEGER REFERENCES resources(id),
            required_resource_type VARCHAR,
            required_resource_category VARCHAR,
            min_quantity INTEGER NOT NULL DEFAULT 1,
            is_hard_stop BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            description VARCHAR NOT NULL,
            duration_minutes INTEGER,
            start_offset_minutes INTEGER NOT NULL DEFAULT 0,
            presence_type VARCHAR,
            active_weekdays JSON,
            active_start_time VARCHAR,
            active_end_time VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS appointments (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id),
            service_id INTEGER NOT NULL REFERENCES services(id),
            client_id INTEGER REFERENCES clients(id),
            patient_id INTEGER REFERENCES patients(id),
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            client_name VARCHAR NOT NULL,
            patient_name VARCHAR NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'scheduled',
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            created_by_user_id INTEGER REFERENCES users(id),
            updated_by_user_id INTEGER REFERENCES users(id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_appointments_clinic_start "
        "ON appointments (clinic_id, start_time)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS appointment_allocations (
            id SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL REFERENCES appointments(id),
            user_id INTEGER REFERENCES users(id),
            resource_id INTEGER REFERENCES resources(id),
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            presence_type VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        """
    )
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
        """
        CREATE TABLE IF NOT EXISTS override_logs (
            id SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL REFERENCES appointments(id),
            rule_id INTEGER REFERENCES rules(id),
            overridden_by_user_id INTEGER NOT NULL REFERENCES users(id),
            override_type VARCHAR NOT NULL DEFAULT 'soft_stop',
            notes VARCHAR,
            timestamp TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        """
    )


def downgrade() -> None:
    # Full schema drop — only for disposable/dev databases.
    op.execute("DROP TABLE IF EXISTS override_logs CASCADE")
    op.execute("DROP TABLE IF EXISTS appointment_allocations CASCADE")
    op.execute("DROP TABLE IF EXISTS appointments CASCADE")
    op.execute("DROP TABLE IF EXISTS rules CASCADE")
    op.execute("DROP TABLE IF EXISTS patients CASCADE")
    op.execute("DROP TABLE IF EXISTS clients CASCADE")
    op.execute("DROP TABLE IF EXISTS services CASCADE")
    op.execute("DROP TABLE IF EXISTS resources CASCADE")
    op.execute("DROP TABLE IF EXISTS refresh_tokens CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.execute("DROP TABLE IF EXISTS roles CASCADE")
    op.execute("DROP TABLE IF EXISTS clinics CASCADE")

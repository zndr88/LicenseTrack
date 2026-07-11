"""add license renewal notification flag

Revision ID: 8b1c2d3e4f6a
Revises: 7f2a9d3c4b61
Create Date: 2026-07-11

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "8b1c2d3e4f6a"
down_revision: str = "7f2a9d3c4b61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "licenses",
        sa.Column(
            "renewal_notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )


def downgrade() -> None:
    op.drop_column("licenses", "renewal_notifications_enabled")

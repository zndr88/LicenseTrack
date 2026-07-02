"""add start_date and end_date to sourcing_items

Revision ID: 4a7b9c0d1e2f
Revises: 3f6a8b0c1d2e
Create Date: 2026-06-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "4a7b9c0d1e2f"
down_revision: str = "6a7b8c9d0e1f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sourcing_items", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("sourcing_items", sa.Column("end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("sourcing_items", "end_date")
    op.drop_column("sourcing_items", "start_date")

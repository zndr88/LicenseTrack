"""add shared PO total override values

Revision ID: 1a2b3c4d5e6f
Revises: 0c5d7e9a1b2c, d0e1f2a3b4c5
Create Date: 2026-08-16 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "1a2b3c4d5e6f"
down_revision = ("0c5d7e9a1b2c", "d0e1f2a3b4c5")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("licenses", sa.Column("po_total_override", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("licenses", "po_total_override")

"""add ui_size to user_settings

Revision ID: 3f6a8b0c1d2e
Revises: 2e5f7a9b1c3d
Create Date: 2026-06-11 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision: str = "3f6a8b0c1d2e"
down_revision: str = "2e5f7a9b1c3d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("ui_size", sa.String(10), nullable=False, server_default="normal"),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "ui_size")

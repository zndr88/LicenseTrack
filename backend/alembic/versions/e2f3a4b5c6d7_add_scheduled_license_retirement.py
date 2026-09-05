"""add scheduled license retirement

Revision ID: e2f3a4b5c6d7
Revises: da1b2c3d4e5f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: str | None = "da1b2c3d4e5f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(
            sa.Column("retirement_scheduled", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )

    op.execute(
        "UPDATE licenses SET retirement_scheduled = 1, is_retired = 0 "
        "WHERE is_retired = 1 AND end_date IS NOT NULL AND end_date >= DATE('now', 'localtime')"
    )


def downgrade() -> None:
    op.execute("UPDATE licenses SET is_retired = 1 WHERE retirement_scheduled = 1")
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("retirement_scheduled")

"""remove inert persisted settings

Revision ID: 9f2c4e6a8b1d
Revises: 8a9b0c1d2e3f
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9f2c4e6a8b1d"
down_revision: Union[str, None] = "8a9b0c1d2e3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.drop_column("manager_email")
        batch_op.drop_column("notification_days")

    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("auth_method")


def downgrade() -> None:
    # The removed values were inert. Recreate their historical defaults so the
    # 1.1.15 ORM remains usable after a code-and-schema rollback.
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "auth_method",
                sa.String(length=20),
                server_default=sa.text("'mfa'"),
                nullable=False,
            )
        )

    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "notification_days",
                sa.Integer(),
                server_default=sa.text("'30'"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "manager_email",
                sa.String(length=255),
                server_default=sa.text("''"),
                nullable=False,
            )
        )

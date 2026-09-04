"""add custom field renewal behavior

Revision ID: da1b2c3d4e5f
Revises: b7e4c2a19d6f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "da1b2c3d4e5f"
down_revision: str | None = "b7e4c2a19d6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.add_column(
            sa.Column("renewal_behavior", sa.String(length=20), nullable=False, server_default="clear")
        )

    op.execute(
        "UPDATE custom_field_definitions "
        "SET renewal_behavior = CASE WHEN carry_forward_on_renewal = 1 THEN 'copy' ELSE 'clear' END"
    )

    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.drop_column("carry_forward_on_renewal")


def downgrade() -> None:
    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.add_column(
            sa.Column("carry_forward_on_renewal", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )

    op.execute(
        "UPDATE custom_field_definitions "
        "SET carry_forward_on_renewal = CASE WHEN renewal_behavior = 'copy' THEN 1 ELSE 0 END"
    )

    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.drop_column("renewal_behavior")

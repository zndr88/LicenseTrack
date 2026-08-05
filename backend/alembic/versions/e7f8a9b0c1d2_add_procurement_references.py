"""add procurement references

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-08-05 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch_op:
        batch_op.add_column(
            sa.Column(
                "procurement_reference",
                sa.String(length=255),
                nullable=False,
                server_default="",
            )
        )

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(
            sa.Column(
                "procurement_reference",
                sa.String(length=255),
                nullable=False,
                server_default="",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("procurement_reference")

    with op.batch_alter_table("pending_orders") as batch_op:
        batch_op.drop_column("procurement_reference")

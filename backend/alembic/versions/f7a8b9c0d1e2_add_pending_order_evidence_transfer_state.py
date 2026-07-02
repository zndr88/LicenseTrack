"""add pending order evidence transfer state

Revision ID: f7a8b9c0d1e2
Revises: e5f6a1b2c3d4
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e5f6a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch_op:
        batch_op.add_column(
            sa.Column("evidence_transfer_status", sa.String(length=50), nullable=True)
        )
        batch_op.add_column(
            sa.Column("evidence_transfer_detail", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("evidence_transfer_failed_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch_op:
        batch_op.drop_column("evidence_transfer_failed_at")
        batch_op.drop_column("evidence_transfer_detail")
        batch_op.drop_column("evidence_transfer_status")

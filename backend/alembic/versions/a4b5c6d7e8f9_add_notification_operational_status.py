"""add notification run guard and operational status fields

Revision ID: a4b5c6d7e8f9
Revises: 9a0b1c2d3e4f
Create Date: 2026-08-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "9a0b1c2d3e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(sa.Column("notification_run_token", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("notification_run_started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_notification_status", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("last_notification_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_notification_summary", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("last_notification_summary")
        batch_op.drop_column("last_notification_at")
        batch_op.drop_column("last_notification_status")
        batch_op.drop_column("notification_run_started_at")
        batch_op.drop_column("notification_run_token")

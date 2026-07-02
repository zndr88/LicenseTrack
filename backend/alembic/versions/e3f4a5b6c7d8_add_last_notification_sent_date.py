"""add last_notification_sent_date to global_settings

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column("last_notification_sent_date", sa.Date(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("last_notification_sent_date")

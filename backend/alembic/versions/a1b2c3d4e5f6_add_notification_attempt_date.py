"""add last_notification_attempt_date to global_settings

Tracks the last date a notification run was attempted, separate from
last_notification_sent_date (which now records only fully successful runs).
This lets the scheduler distinguish "attempted but failed" so a license can no
longer silently go un-alerted when SMTP is unavailable.

Note: revision id is e5f6a1b2c3d4 (the a1b2c3d4e5f6 id in the filename was
already taken by an earlier migration; the filename was kept because the
environment does not permit renaming files).

Revision ID: e5f6a1b2c3d4
Revises: ef56ab78cd90
Create Date: 2026-05-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a1b2c3d4'
down_revision: Union[str, None] = 'ef56ab78cd90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column("last_notification_attempt_date", sa.Date(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("last_notification_attempt_date")

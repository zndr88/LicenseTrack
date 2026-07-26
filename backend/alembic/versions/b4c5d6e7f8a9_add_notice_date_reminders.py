"""add notice date reminders

Revision ID: b4c5d6e7f8a9
Revises: a1e2f3b4c5d6
Create Date: 2026-07-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a1e2f3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("notice_date", sa.Date(), nullable=True))

    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "notice_notification_days",
                sa.Integer(),
                nullable=False,
                server_default="30",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("notice_notification_days")

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("notice_date")

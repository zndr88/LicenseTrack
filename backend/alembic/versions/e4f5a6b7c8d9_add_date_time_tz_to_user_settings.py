"""add date_format, time_format, time_zone to user_settings

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "date_format",
                sa.String(20),
                nullable=False,
                server_default="DD/MM/YYYY",
            )
        )
        batch_op.add_column(
            sa.Column(
                "time_format",
                sa.String(5),
                nullable=False,
                server_default="24h",
            )
        )
        batch_op.add_column(
            sa.Column(
                "time_zone",
                sa.String(50),
                nullable=False,
                server_default="UTC",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.drop_column("time_zone")
        batch_op.drop_column("time_format")
        batch_op.drop_column("date_format")

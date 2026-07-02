"""add high_value_threshold to global_settings

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "high_value_threshold",
                sa.Numeric(precision=18, scale=2),
                nullable=False,
                server_default="50000",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("high_value_threshold")

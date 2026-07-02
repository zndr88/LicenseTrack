"""add fiscal_year_start_month to global_settings

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "fiscal_year_start_month",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch_op:
        batch_op.drop_column("fiscal_year_start_month")

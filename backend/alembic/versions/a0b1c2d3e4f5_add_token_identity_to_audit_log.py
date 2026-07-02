"""add token identity columns to audit_log

Revision ID: a0b1c2d3e4f5
Revises: f7a8b9c0d1e2
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("audit_log") as batch_op:
        batch_op.add_column(sa.Column("actor_token_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("actor_token_name", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("audit_log") as batch_op:
        batch_op.drop_column("actor_token_name")
        batch_op.drop_column("actor_token_id")

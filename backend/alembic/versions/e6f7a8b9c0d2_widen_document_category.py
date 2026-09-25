"""Widen documents.category to fit every document category.

Revision ID: e6f7a8b9c0d2
Revises: d5e6f7a8b9c1
"""

import sqlalchemy as sa
from alembic import op

revision = "e6f7a8b9c0d2"
down_revision = "d5e6f7a8b9c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column(
            "category",
            existing_type=sa.String(length=11),
            type_=sa.String(length=20),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column(
            "category",
            existing_type=sa.String(length=20),
            type_=sa.String(length=11),
            existing_nullable=False,
        )

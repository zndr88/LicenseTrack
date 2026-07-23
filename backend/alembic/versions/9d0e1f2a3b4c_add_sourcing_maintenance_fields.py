"""add sourcing maintenance fields

Revision ID: 9d0e1f2a3b4c
Revises: 8c9d0e1f2a3b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9d0e1f2a3b4c"
down_revision: str | None = "8c9d0e1f2a3b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.add_column(sa.Column("maintenance_coverage", sa.String(length=18), nullable=True))
        batch_op.add_column(sa.Column("maintenance_start_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("maintenance_end_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("maintenance_cost", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("parent_sourcing_item_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_sourcing_items_parent_sourcing_item_id",
            "sourcing_items",
            ["parent_sourcing_item_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_sourcing_items_parent_sourcing_item_id",
            ["parent_sourcing_item_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.drop_index("ix_sourcing_items_parent_sourcing_item_id")
        batch_op.drop_constraint("fk_sourcing_items_parent_sourcing_item_id", type_="foreignkey")
        batch_op.drop_column("parent_sourcing_item_id")
        batch_op.drop_column("maintenance_cost")
        batch_op.drop_column("maintenance_end_date")
        batch_op.drop_column("maintenance_start_date")
        batch_op.drop_column("maintenance_coverage")

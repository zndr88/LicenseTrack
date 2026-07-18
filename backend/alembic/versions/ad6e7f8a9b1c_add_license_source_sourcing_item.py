"""add license source sourcing item

Revision ID: ad6e7f8a9b1c
Revises: 9c2d3e4f5a6b
Create Date: 2026-07-18

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "ad6e7f8a9b1c"
down_revision: Union[str, None] = "9c2d3e4f5a6b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_sourcing_item_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_licenses_source_sourcing_item_id", ["source_sourcing_item_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_license_source_sourcing_item",
            "sourcing_items",
            ["source_sourcing_item_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses", schema=None) as batch_op:
        batch_op.drop_constraint("fk_license_source_sourcing_item", type_="foreignkey")
        batch_op.drop_index("ix_licenses_source_sourcing_item_id")
        batch_op.drop_column("source_sourcing_item_id")

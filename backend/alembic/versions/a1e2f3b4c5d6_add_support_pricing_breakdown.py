"""add support pricing breakdown

Revision ID: a1e2f3b4c5d6
Revises: 9d0e1f2a3b4c
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1e2f3b4c5d6"
down_revision: str | None = "9d0e1f2a3b4c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in ("licenses", "sourcing_items"):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(sa.Column("maintenance_pricing_basis", sa.String(length=8), nullable=True))
            batch_op.add_column(sa.Column("maintenance_quantity", sa.String(length=100), nullable=True))
            batch_op.add_column(sa.Column("maintenance_unit_price", sa.String(length=50), nullable=True))


def downgrade() -> None:
    for table_name in ("sourcing_items", "licenses"):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column("maintenance_unit_price")
            batch_op.drop_column("maintenance_quantity")
            batch_op.drop_column("maintenance_pricing_basis")

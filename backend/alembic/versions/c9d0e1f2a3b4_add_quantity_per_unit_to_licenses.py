"""add quantity per unit to licenses

Revision ID: c9d0e1f2a3b4
Revises: b8c2d4e6f8a0
Create Date: 2026-08-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c2d4e6f8a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("quantity_per_unit", sa.String(length=100), nullable=True, server_default="1"))

    licenses = sa.table(
        "licenses",
        sa.column("id", sa.Integer),
        sa.column("quantity_per_unit", sa.String),
    )
    bind = op.get_bind()
    bind.execute(licenses.update().where(licenses.c.quantity_per_unit.is_(None)).values(quantity_per_unit="1"))

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.alter_column("quantity_per_unit", nullable=False, server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("quantity_per_unit")

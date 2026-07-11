"""add repeatable invoice numbers to licenses

Revision ID: 7f2a9d3c4b61
Revises: 4a7b9c0d1e2f
Create Date: 2026-07-11

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "7f2a9d3c4b61"
down_revision: str = "4a7b9c0d1e2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("licenses", sa.Column("invoice_numbers", sa.JSON(), nullable=True))

    licenses = sa.table(
        "licenses",
        sa.column("id", sa.Integer),
        sa.column("invoice_number", sa.String),
        sa.column("invoice_numbers", sa.JSON),
    )
    bind = op.get_bind()
    for row in bind.execute(sa.select(licenses.c.id, licenses.c.invoice_number)):
        primary = row.invoice_number or ""
        bind.execute(
            licenses.update()
            .where(licenses.c.id == row.id)
            .values(invoice_numbers=[primary] if primary else [])
        )

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.alter_column("invoice_numbers", nullable=False)


def downgrade() -> None:
    op.drop_column("licenses", "invoice_numbers")

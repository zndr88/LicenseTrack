"""add procurement milestone dates to licenses

Revision ID: 1d4e6f8a9b0c
Revises: e4f5a6b7c8d9
Create Date: 2026-06-01 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "1d4e6f8a9b0c"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "licenses",
        sa.Column("request_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "licenses",
        sa.Column("purchase_date", sa.DateTime(timezone=True), nullable=True),
    )

    # A license always identifies its purchase order, so this backfill is safe.
    op.execute(
        """
        UPDATE licenses
        SET purchase_date = (
            SELECT pending_orders.created_at
            FROM pending_orders
            WHERE pending_orders.id = licenses.pending_order_id
        )
        WHERE pending_order_id IS NOT NULL
          AND purchase_date IS NULL
        """
    )

    # Older licenses do not identify their source line. Backfill only orders
    # with one line; multi-line orders cannot be mapped without guessing.
    op.execute(
        """
        UPDATE licenses
        SET request_date = (
            SELECT sourcing_items.created_at
            FROM sourcing_items
            WHERE sourcing_items.pending_order_id = licenses.pending_order_id
        )
        WHERE pending_order_id IS NOT NULL
          AND request_date IS NULL
          AND (
              SELECT COUNT(*)
              FROM sourcing_items
              WHERE sourcing_items.pending_order_id = licenses.pending_order_id
          ) = 1
        """
    )


def downgrade() -> None:
    op.drop_column("licenses", "purchase_date")
    op.drop_column("licenses", "request_date")

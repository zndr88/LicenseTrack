"""Add an optional manual PO total to pending orders.

Existing orders get NULL (no override), so their totals keep coming from the
line estimates.
"""

from alembic import op
import sqlalchemy as sa


revision = "a7b8c9d0e1f2"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch:
        batch.add_column(sa.Column("po_total_override", sa.String(length=50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch:
        batch.drop_column("po_total_override")

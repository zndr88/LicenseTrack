"""Persist whether a converted order requires invoice evidence for retry."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "5e6f7a8b9c0d"
down_revision: Union[str, None] = "4d5e6f7a8b9c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "evidence_invoice_required" not in {c["name"] for c in inspector.get_columns("pending_orders")}:
        op.add_column("pending_orders", sa.Column("evidence_invoice_required", sa.Boolean(), nullable=False, server_default="0"))
    op.execute(sa.text(
        "UPDATE pending_orders SET evidence_invoice_required = 1 "
        "WHERE id IN (SELECT pending_order_id FROM procurement_documents "
        "WHERE pending_order_id IS NOT NULL AND category = 'invoice')"
    ))


def downgrade() -> None:
    op.drop_column("pending_orders", "evidence_invoice_required")

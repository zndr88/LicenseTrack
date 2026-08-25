"""add sourcing quote provenance to procurement documents"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "8b9c0d1e2f3a"
down_revision: tuple[str, str] = ("7a8b9c0d1e2f", "d0e1f2a3b4c5")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("procurement_documents") as batch_op:
        batch_op.add_column(sa.Column("source_sourcing_quote_document_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_procurement_documents_source_sourcing_quote_document_id", ["source_sourcing_quote_document_id"])
        batch_op.create_unique_constraint("uq_procurement_document_pending_quote_source", ["pending_order_id", "source_sourcing_quote_document_id"])


def downgrade() -> None:
    with op.batch_alter_table("procurement_documents") as batch_op:
        batch_op.drop_constraint("uq_procurement_document_pending_quote_source", type_="unique")
        batch_op.drop_index("ix_procurement_documents_source_sourcing_quote_document_id")
        batch_op.drop_column("source_sourcing_quote_document_id")

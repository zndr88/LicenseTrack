"""Record PO-number sharing for new uploads without changing existing evidence."""

from alembic import op
import sqlalchemy as sa

revision = "c912ee470a63"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("procurement_documents", sa.Column("shared_po_number", sa.String(255), nullable=True))
    op.create_index("ix_procurement_documents_shared_po_number", "procurement_documents", ["shared_po_number"])


def downgrade():
    op.drop_index("ix_procurement_documents_shared_po_number", table_name="procurement_documents")
    op.drop_column("procurement_documents", "shared_po_number")

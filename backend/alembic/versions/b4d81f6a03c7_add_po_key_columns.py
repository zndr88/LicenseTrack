"""add po key columns

Stores the normalized PO number next to the visible one on licenses and on
procurement documents shared by PO, so PO matching is a plain indexed
comparison instead of a function the database has to provide. Existing rows
are filled in from their current PO number.

Revision ID: b4d81f6a03c7
Revises: 7c3e9a41b2d5
Create Date: 2026-11-19 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d81f6a03c7'
down_revision: Union[str, None] = '7c3e9a41b2d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize(value: str | None) -> str:
    # Frozen copy of procurement_identity.normalize_po_number as of this migration.
    return " ".join((value or "").split()).casefold()


def upgrade() -> None:
    op.add_column("licenses", sa.Column("po_key", sa.Text(), nullable=False, server_default=""))
    op.create_index("ix_licenses_po_key", "licenses", ["po_key"])
    op.add_column("procurement_documents", sa.Column("shared_po_key", sa.Text(), nullable=True))
    op.create_index("ix_procurement_documents_shared_po_key", "procurement_documents", ["shared_po_key"])

    bind = op.get_bind()
    licenses = bind.execute(
        sa.text("SELECT id, po_number FROM licenses WHERE po_number IS NOT NULL AND po_number <> ''")
    ).fetchall()
    for row_id, po_number in licenses:
        bind.execute(
            sa.text("UPDATE licenses SET po_key = :key WHERE id = :id"),
            {"key": _normalize(po_number), "id": row_id},
        )
    documents = bind.execute(
        sa.text("SELECT id, shared_po_number FROM procurement_documents WHERE shared_po_number IS NOT NULL")
    ).fetchall()
    for row_id, shared in documents:
        bind.execute(
            sa.text("UPDATE procurement_documents SET shared_po_key = :key WHERE id = :id"),
            {"key": _normalize(shared), "id": row_id},
        )


def downgrade() -> None:
    op.drop_index("ix_procurement_documents_shared_po_key", table_name="procurement_documents")
    op.drop_column("procurement_documents", "shared_po_key")
    op.drop_index("ix_licenses_po_key", table_name="licenses")
    op.drop_column("licenses", "po_key")

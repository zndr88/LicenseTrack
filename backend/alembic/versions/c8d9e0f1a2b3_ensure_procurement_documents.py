"""ensure procurement documents table

Revision ID: c8d9e0f1a2b3
Revises: c7d8e9f0a1b2
Create Date: 2026-05-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _create_procurement_documents() -> None:
    op.create_table(
        "procurement_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("po_number", sa.String(length=255), nullable=False),
        sa.Column("pending_order_id", sa.Integer(), nullable=True),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column(
            "category",
            sa.Enum("quote", "purchase_order", "invoice", name="procurementdocumentcategory"),
            nullable=False,
        ),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["pending_order_id"], ["pending_orders.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_procurement_documents_pending_order_id"),
        "procurement_documents",
        ["pending_order_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_procurement_documents_po_number"),
        "procurement_documents",
        ["po_number"],
        unique=False,
    )


def upgrade() -> None:
    tables = _tables()
    if "procurement_documents" not in tables:
        _create_procurement_documents()
        tables.add("procurement_documents")

    if "pending_order_documents" in tables and "pending_orders" in tables:
        op.execute(
            """
            INSERT INTO procurement_documents (
                po_number,
                pending_order_id,
                filename,
                original_filename,
                file_size,
                mime_type,
                category,
                uploaded_at,
                uploaded_by
            )
            SELECT
                pending_orders.po_number,
                pending_order_documents.pending_order_id,
                pending_order_documents.filename,
                pending_order_documents.original_filename,
                pending_order_documents.file_size,
                pending_order_documents.mime_type,
                'purchase_order',
                pending_order_documents.uploaded_at,
                pending_order_documents.uploaded_by
            FROM pending_order_documents
            JOIN pending_orders ON pending_orders.id = pending_order_documents.pending_order_id
            WHERE NOT EXISTS (
                SELECT 1 FROM procurement_documents
                WHERE procurement_documents.po_number = pending_orders.po_number
                  AND procurement_documents.filename = pending_order_documents.filename
            )
            """
        )


def downgrade() -> None:
    # Keep this repair migration non-destructive. The previous revision owns
    # dropping procurement_documents when a full downgrade is requested.
    pass

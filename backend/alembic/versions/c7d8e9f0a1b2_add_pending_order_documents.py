"""add procurement documents

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-05-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "procurement_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("po_number", sa.String(length=255), nullable=False),
        sa.Column("pending_order_id", sa.Integer(), nullable=True),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("category", sa.Enum("quote", "purchase_order", "invoice", name="procurementdocumentcategory"), nullable=False),
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


def downgrade() -> None:
    op.drop_index(op.f("ix_procurement_documents_po_number"), table_name="procurement_documents")
    op.drop_index(op.f("ix_procurement_documents_pending_order_id"), table_name="procurement_documents")
    op.drop_table("procurement_documents")

"""add document processing results

Revision ID: ef56ab78cd90
Revises: de45fa67bc89
Create Date: 2026-05-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ef56ab78cd90"
down_revision: Union[str, None] = "de45fa67bc89"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_processing_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("license_id", sa.Integer(), nullable=True),
        sa.Column("capability_key", sa.String(length=150), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="pending", nullable=False),
        sa.Column("suggested_fields", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("raw_output", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["license_id"], ["licenses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_processing_results_capability_key"), "document_processing_results", ["capability_key"], unique=False)
    op.create_index(op.f("ix_document_processing_results_document_id"), "document_processing_results", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_processing_results_license_id"), "document_processing_results", ["license_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_processing_results_license_id"), table_name="document_processing_results")
    op.drop_index(op.f("ix_document_processing_results_document_id"), table_name="document_processing_results")
    op.drop_index(op.f("ix_document_processing_results_capability_key"), table_name="document_processing_results")
    op.drop_table("document_processing_results")

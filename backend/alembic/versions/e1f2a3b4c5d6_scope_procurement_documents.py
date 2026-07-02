"""scope_procurement_documents

Revision ID: e1f2a3b4c5d6
Revises: c8d9e0f1a2b3
Create Date: 2026-05-17 11:55:00.000000

"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    license_columns = {column["name"] for column in inspector.get_columns("licenses")}
    procurement_columns = {column["name"] for column in inspector.get_columns("procurement_documents")}
    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}
    procurement_indexes = {index["name"] for index in inspector.get_indexes("procurement_documents")}

    if "pending_order_id" not in license_columns:
        op.add_column("licenses", sa.Column("pending_order_id", sa.Integer(), nullable=True))
    if "ix_licenses_pending_order_id" not in license_indexes:
        op.create_index("ix_licenses_pending_order_id", "licenses", ["pending_order_id"])

    if "license_id" not in procurement_columns:
        op.add_column("procurement_documents", sa.Column("license_id", sa.Integer(), nullable=True))
    if "ix_procurement_documents_license_id" not in procurement_indexes:
        op.create_index("ix_procurement_documents_license_id", "procurement_documents", ["license_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    license_columns = {column["name"] for column in inspector.get_columns("licenses")}
    procurement_columns = {column["name"] for column in inspector.get_columns("procurement_documents")}
    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}
    procurement_indexes = {index["name"] for index in inspector.get_indexes("procurement_documents")}

    if "ix_procurement_documents_license_id" in procurement_indexes:
        op.drop_index("ix_procurement_documents_license_id", table_name="procurement_documents")
    if "license_id" in procurement_columns:
        op.drop_column("procurement_documents", "license_id")

    if "ix_licenses_pending_order_id" in license_indexes:
        op.drop_index("ix_licenses_pending_order_id", table_name="licenses")
    if "pending_order_id" in license_columns:
        op.drop_column("licenses", "pending_order_id")

"""add immutable license coverage history snapshots

Revision ID: 2b3c4d5e6f70
Revises: 1a2b3c4d5e6f
"""

from alembic import op
import sqlalchemy as sa


revision = "2b3c4d5e6f70"
down_revision = "1a2b3c4d5e6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "license_coverage_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("parent_license_id", sa.Integer(), nullable=False),
        sa.Column("maintenance_license_id", sa.Integer(), nullable=True),
        sa.Column("coverage_type", sa.String(length=40), nullable=False),
        sa.Column("source_type", sa.String(length=60), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("pricing_basis", sa.String(length=30), nullable=True),
        sa.Column("quantity", sa.String(length=100), nullable=True),
        sa.Column("unit_price", sa.String(length=50), nullable=True),
        sa.Column("cost", sa.String(length=50), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="EUR"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["parent_license_id"], ["licenses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["maintenance_license_id"], ["licenses.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_license_coverage_history_parent_license_id", "license_coverage_history", ["parent_license_id"])
    op.create_index(
        "ix_license_coverage_history_maintenance_license_id",
        "license_coverage_history",
        ["maintenance_license_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_license_coverage_history_maintenance_license_id", table_name="license_coverage_history")
    op.drop_index("ix_license_coverage_history_parent_license_id", table_name="license_coverage_history")
    op.drop_table("license_coverage_history")

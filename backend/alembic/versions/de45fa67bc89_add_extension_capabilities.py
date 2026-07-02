"""add extension capabilities

Revision ID: de45fa67bc89
Revises: cd34ef56ab12
Create Date: 2026-05-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "de45fa67bc89"
down_revision: Union[str, None] = "cd34ef56ab12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "extension_capabilities",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(length=150), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("capability_type", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="available", nullable=False),
        sa.Column("version", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("health_url", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_extension_capabilities_key"),
    )
    op.create_index(op.f("ix_extension_capabilities_capability_type"), "extension_capabilities", ["capability_type"], unique=False)
    op.create_index(op.f("ix_extension_capabilities_key"), "extension_capabilities", ["key"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_extension_capabilities_key"), table_name="extension_capabilities")
    op.drop_index(op.f("ix_extension_capabilities_capability_type"), table_name="extension_capabilities")
    op.drop_table("extension_capabilities")

"""add plugin suggestions

Revision ID: 6a7b8c9d0e1f
Revises: 4b7c8d9e0f12
Create Date: 2026-06-14
"""

from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "6a7b8c9d0e1f"
down_revision: Union[str, None] = "4b7c8d9e0f12"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "plugin_suggestions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=True),
        sa.Column("plugin_key", sa.String(length=80), nullable=False),
        sa.Column("action_key", sa.String(length=80), nullable=False),
        sa.Column("target_type", sa.String(length=80), nullable=False),
        sa.Column("target_id", sa.String(length=120), nullable=False),
        sa.Column("license_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="pending", nullable=False),
        sa.Column("suggested_fields", sa.JSON(), nullable=False),
        sa.Column("line_items", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("raw_output", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["license_id"], ["licenses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_plugin_suggestions_action_key"), "plugin_suggestions", ["action_key"], unique=False)
    op.create_index(op.f("ix_plugin_suggestions_license_id"), "plugin_suggestions", ["license_id"], unique=False)
    op.create_index(op.f("ix_plugin_suggestions_plugin_id"), "plugin_suggestions", ["plugin_id"], unique=False)
    op.create_index(op.f("ix_plugin_suggestions_plugin_key"), "plugin_suggestions", ["plugin_key"], unique=False)
    op.create_index(op.f("ix_plugin_suggestions_target_id"), "plugin_suggestions", ["target_id"], unique=False)
    op.create_index(op.f("ix_plugin_suggestions_target_type"), "plugin_suggestions", ["target_type"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_plugin_suggestions_target_type"), table_name="plugin_suggestions")
    op.drop_index(op.f("ix_plugin_suggestions_target_id"), table_name="plugin_suggestions")
    op.drop_index(op.f("ix_plugin_suggestions_plugin_key"), table_name="plugin_suggestions")
    op.drop_index(op.f("ix_plugin_suggestions_plugin_id"), table_name="plugin_suggestions")
    op.drop_index(op.f("ix_plugin_suggestions_license_id"), table_name="plugin_suggestions")
    op.drop_index(op.f("ix_plugin_suggestions_action_key"), table_name="plugin_suggestions")
    op.drop_table("plugin_suggestions")

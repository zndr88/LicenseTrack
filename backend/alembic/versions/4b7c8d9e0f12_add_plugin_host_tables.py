"""add plugin host tables

Revision ID: 4b7c8d9e0f12
Revises: 3f6a8b0c1d2e
Create Date: 2026-06-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4b7c8d9e0f12"
down_revision: Union[str, None] = "3f6a8b0c1d2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "plugins",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("publisher_name", sa.String(length=120), nullable=False),
        sa.Column("publisher_url", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("installed_version", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="disabled", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("compatibility_status", sa.String(length=30), server_default="unknown", nullable=False),
        sa.Column("install_path", sa.Text(), nullable=False),
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_plugins_key"),
    )
    op.create_index(op.f("ix_plugins_key"), "plugins", ["key"], unique=False)

    op.create_table(
        "plugin_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(length=80), nullable=False),
        sa.Column("package_path", sa.Text(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("installed_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", "version", name="uq_plugin_versions_plugin_version"),
    )
    op.create_index(op.f("ix_plugin_versions_plugin_id"), "plugin_versions", ["plugin_id"], unique=False)

    op.create_table(
        "plugin_permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("permission", sa.String(length=120), nullable=False),
        sa.Column("granted", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("granted_by", sa.Integer(), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", "permission", name="uq_plugin_permissions_plugin_permission"),
    )
    op.create_index(op.f("ix_plugin_permissions_plugin_id"), "plugin_permissions", ["plugin_id"], unique=False)

    op.create_table(
        "plugin_setting_definitions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("setting_key", sa.String(length=80), nullable=False),
        sa.Column("setting_type", sa.String(length=30), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("required", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("default_value", sa.JSON(), nullable=True),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), server_default="1000", nullable=False),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", "setting_key", name="uq_plugin_setting_definitions_plugin_key"),
    )
    op.create_index(
        op.f("ix_plugin_setting_definitions_plugin_id"),
        "plugin_setting_definitions",
        ["plugin_id"],
        unique=False,
    )

    op.create_table(
        "plugin_setting_values",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("setting_key", sa.String(length=80), nullable=False),
        sa.Column("encrypted_value", sa.Text(), nullable=True),
        sa.Column("value_metadata", sa.JSON(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", "setting_key", name="uq_plugin_setting_values_plugin_key"),
    )
    op.create_index(op.f("ix_plugin_setting_values_plugin_id"), "plugin_setting_values", ["plugin_id"], unique=False)

    op.create_table(
        "plugin_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("action_key", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("slot", sa.String(length=120), nullable=False),
        sa.Column("handler", sa.String(length=120), nullable=False),
        sa.Column("required_role", sa.String(length=30), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("icon", sa.String(length=80), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", "action_key", name="uq_plugin_actions_plugin_action"),
    )
    op.create_index(op.f("ix_plugin_actions_plugin_id"), "plugin_actions", ["plugin_id"], unique=False)
    op.create_index(op.f("ix_plugin_actions_slot"), "plugin_actions", ["slot"], unique=False)

    op.create_table(
        "plugin_runtime_status",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plugin_id", sa.Integer(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("process_metadata", sa.JSON(), nullable=True),
        sa.Column("health", sa.String(length=30), server_default="unknown", nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("log_path", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plugin_id", name="uq_plugin_runtime_status_plugin"),
    )
    op.create_index(op.f("ix_plugin_runtime_status_plugin_id"), "plugin_runtime_status", ["plugin_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_plugin_runtime_status_plugin_id"), table_name="plugin_runtime_status")
    op.drop_table("plugin_runtime_status")
    op.drop_index(op.f("ix_plugin_actions_slot"), table_name="plugin_actions")
    op.drop_index(op.f("ix_plugin_actions_plugin_id"), table_name="plugin_actions")
    op.drop_table("plugin_actions")
    op.drop_index(op.f("ix_plugin_setting_values_plugin_id"), table_name="plugin_setting_values")
    op.drop_table("plugin_setting_values")
    op.drop_index(op.f("ix_plugin_setting_definitions_plugin_id"), table_name="plugin_setting_definitions")
    op.drop_table("plugin_setting_definitions")
    op.drop_index(op.f("ix_plugin_permissions_plugin_id"), table_name="plugin_permissions")
    op.drop_table("plugin_permissions")
    op.drop_index(op.f("ix_plugin_versions_plugin_id"), table_name="plugin_versions")
    op.drop_table("plugin_versions")
    op.drop_index(op.f("ix_plugins_key"), table_name="plugins")
    op.drop_table("plugins")

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Plugin(Base):
    __tablename__ = "plugins"
    __table_args__ = (UniqueConstraint("key", name="uq_plugins_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    publisher_name: Mapped[str] = mapped_column(String(120), nullable=False)
    publisher_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    installed_version: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="disabled", server_default="disabled")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    compatibility_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="unknown",
        server_default="unknown",
    )
    trust_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="unverified", server_default="unverified"
    )
    signer_key_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    signer_identity: Mapped[str | None] = mapped_column(String(200), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    install_path: Mapped[str] = mapped_column(Text, nullable=False)
    manifest: Mapped[dict] = mapped_column(JSON, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        server_default=func.now(),
        nullable=False,
    )

    versions: Mapped[list["PluginVersion"]] = relationship(
        "PluginVersion",
        back_populates="plugin",
        cascade="all, delete-orphan",
    )
    permissions: Mapped[list["PluginPermission"]] = relationship(
        "PluginPermission",
        back_populates="plugin",
        cascade="all, delete-orphan",
    )
    setting_definitions: Mapped[list["PluginSettingDefinition"]] = relationship(
        "PluginSettingDefinition",
        back_populates="plugin",
        cascade="all, delete-orphan",
    )
    setting_values: Mapped[list["PluginSettingValue"]] = relationship(
        "PluginSettingValue",
        back_populates="plugin",
        cascade="all, delete-orphan",
    )
    actions: Mapped[list["PluginAction"]] = relationship(
        "PluginAction",
        back_populates="plugin",
        cascade="all, delete-orphan",
    )
    runtime_status: Mapped["PluginRuntimeStatus | None"] = relationship(
        "PluginRuntimeStatus",
        back_populates="plugin",
        cascade="all, delete-orphan",
        uselist=False,
    )


class PluginVersion(Base):
    __tablename__ = "plugin_versions"
    __table_args__ = (UniqueConstraint("plugin_id", "version", name="uq_plugin_versions_plugin_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[str] = mapped_column(String(80), nullable=False)
    package_path: Mapped[str] = mapped_column(Text, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    signed_content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    trust_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="unverified", server_default="unverified"
    )
    signer_key_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    signer_identity: Mapped[str | None] = mapped_column(String(200), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    manifest: Mapped[dict] = mapped_column(JSON, nullable=False)
    installed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        server_default=func.now(),
        nullable=False,
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="versions")


class PluginPermission(Base):
    __tablename__ = "plugin_permissions"
    __table_args__ = (UniqueConstraint("plugin_id", "permission", name="uq_plugin_permissions_plugin_permission"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission: Mapped[str] = mapped_column(String(120), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    granted_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="permissions")


class PluginSettingDefinition(Base):
    __tablename__ = "plugin_setting_definitions"
    __table_args__ = (UniqueConstraint("plugin_id", "setting_key", name="uq_plugin_setting_definitions_plugin_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    setting_key: Mapped[str] = mapped_column(String(80), nullable=False)
    setting_type: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    default_value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    help_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1000, server_default="1000")

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="setting_definitions")


class PluginSettingValue(Base):
    __tablename__ = "plugin_setting_values"
    __table_args__ = (UniqueConstraint("plugin_id", "setting_key", name="uq_plugin_setting_values_plugin_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    setting_key: Mapped[str] = mapped_column(String(80), nullable=False)
    encrypted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="setting_values")


class PluginAction(Base):
    __tablename__ = "plugin_actions"
    __table_args__ = (UniqueConstraint("plugin_id", "action_key", name="uq_plugin_actions_plugin_action"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    slot: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    handler: Mapped[str] = mapped_column(String(120), nullable=False)
    required_role: Mapped[str] = mapped_column(String(30), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    icon: Mapped[str | None] = mapped_column(String(80), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="actions")


class PluginRuntimeStatus(Base):
    __tablename__ = "plugin_runtime_status"
    __table_args__ = (UniqueConstraint("plugin_id", name="uq_plugin_runtime_status_plugin"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    process_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    health: Mapped[str] = mapped_column(String(30), nullable=False, default="unknown", server_default="unknown")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    log_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        server_default=func.now(),
        nullable=False,
    )

    plugin: Mapped[Plugin] = relationship("Plugin", back_populates="runtime_status")

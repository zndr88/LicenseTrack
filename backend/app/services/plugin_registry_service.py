from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.plugin import (
    Plugin,
    PluginAction,
    PluginPermission,
    PluginRuntimeStatus,
    PluginSettingDefinition,
    PluginVersion,
)
from app.schemas.plugin import PluginRegistryCreate, PluginRegistryUpdate


class PluginRegistryError(ValueError):
    """Raised when a plugin registry operation violates host registry rules."""


def _ensure_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise PluginRegistryError(f"Duplicate plugin {label} declarations are not allowed")


async def get_plugin(db: AsyncSession, plugin_key: str) -> Plugin | None:
    result = await db.execute(
        select(Plugin)
        .options(
            selectinload(Plugin.versions),
            selectinload(Plugin.permissions),
            selectinload(Plugin.setting_definitions),
            selectinload(Plugin.actions),
            selectinload(Plugin.runtime_status),
        )
        .where(Plugin.key == plugin_key)
    )
    return result.scalar_one_or_none()


async def list_plugins(db: AsyncSession) -> list[Plugin]:
    result = await db.execute(
        select(Plugin)
        .options(
            selectinload(Plugin.versions),
            selectinload(Plugin.permissions),
            selectinload(Plugin.setting_definitions),
            selectinload(Plugin.actions),
            selectinload(Plugin.runtime_status),
        )
        .order_by(Plugin.name.asc(), Plugin.key.asc())
    )
    return list(result.scalars().all())


async def create_plugin_registry_record(db: AsyncSession, payload: PluginRegistryCreate) -> Plugin:
    existing = await db.scalar(select(Plugin.id).where(Plugin.key == payload.key))
    if existing is not None:
        raise PluginRegistryError(f"Plugin '{payload.key}' is already installed")

    _ensure_unique([permission.permission for permission in payload.permissions], "permission")
    _ensure_unique([setting.key for setting in payload.settings], "setting")
    _ensure_unique([action.key for action in payload.actions], "action")

    plugin = Plugin(
        key=payload.key,
        name=payload.name,
        publisher_name=payload.publisher_name,
        publisher_url=payload.publisher_url,
        description=payload.description,
        installed_version=payload.installed_version,
        status="disabled",
        enabled=False,
        compatibility_status=payload.compatibility_status,
        install_path=payload.install_path,
        manifest=payload.manifest,
    )
    db.add(plugin)
    await db.flush()

    db.add(
        PluginVersion(
            plugin_id=plugin.id,
            version=payload.installed_version,
            package_path=payload.package_path,
            checksum_sha256=payload.checksum_sha256,
            manifest=payload.manifest,
        )
    )
    db.add(PluginRuntimeStatus(plugin_id=plugin.id, health="unknown"))

    for permission in payload.permissions:
        db.add(
            PluginPermission(
                plugin_id=plugin.id,
                permission=permission.permission,
                granted=permission.granted,
                granted_at=datetime.now(timezone.utc) if permission.granted else None,
            )
        )

    for setting in payload.settings:
        db.add(
            PluginSettingDefinition(
                plugin_id=plugin.id,
                setting_key=setting.key,
                setting_type=setting.type,
                label=setting.label,
                required=setting.required,
                default_value=setting.default,
                options=setting.options,
                help_text=setting.help_text,
                display_order=setting.order,
            )
        )

    for action in payload.actions:
        db.add(
            PluginAction(
                plugin_id=plugin.id,
                action_key=action.key,
                label=action.label,
                slot=action.slot,
                handler=action.handler,
                required_role=action.required_role,
                enabled=action.enabled,
                icon=action.icon,
                description=action.description,
                timeout_seconds=action.timeout_seconds,
            )
        )

    await db.flush()
    created = await get_plugin(db, payload.key)
    if created is None:
        raise PluginRegistryError("Created plugin could not be loaded")
    return created


async def update_plugin_registry_record(
    db: AsyncSession,
    plugin_key: str,
    payload: PluginRegistryUpdate,
) -> Plugin:
    plugin = await get_plugin(db, plugin_key)
    if plugin is None:
        raise PluginRegistryError(f"Plugin '{plugin_key}' is not installed")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(plugin, field, value)
    await db.flush()
    return plugin

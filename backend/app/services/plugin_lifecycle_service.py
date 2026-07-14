from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.extension import ExtensionCapability
from app.models.plugin import Plugin, PluginAction
from app.models.plugin_suggestion import PluginSuggestion
from app.services.plugin_runtime_service import restart_plugin_runtime, stop_plugin_runtime
from app.services.plugin_settings_service import read_plugin_settings


class PluginLifecycleError(ValueError):
    """Raised when plugin lifecycle state cannot change safely."""


async def enable_plugin(db: AsyncSession, plugin_key: str, *, actor_id: int | None) -> Plugin:
    plugin = await _get_plugin(db, plugin_key)
    if plugin.compatibility_status != "compatible":
        raise PluginLifecycleError("Plugin is not compatible with this LicenseTrack version")

    settings_response = await read_plugin_settings(db, plugin.key)
    if settings_response.missing_required:
        plugin.status = "misconfigured"
        plugin.enabled = False
        plugin.last_error = f"Missing required plugin setting(s): {', '.join(settings_response.missing_required)}"
        await _set_actions_enabled(plugin, enabled=False)
        await db.flush()
        raise PluginLifecycleError(plugin.last_error)

    now = datetime.now(timezone.utc)
    for permission in plugin.permissions:
        if permission.granted:
            continue
        permission.granted = True
        permission.granted_by = actor_id
        permission.granted_at = now

    await _set_actions_enabled(plugin, enabled=True)
    await _set_manifest_capabilities(db, plugin, status="available", actor_id=actor_id)
    plugin.enabled = True
    plugin.status = "enabled"
    plugin.last_error = None
    for version in plugin.versions:
        if version.version == plugin.installed_version and version.activated_at is None:
            version.activated_at = now

    await db.flush()
    try:
        await restart_plugin_runtime(db, plugin.key)
    except Exception as exc:
        await _set_actions_enabled(plugin, enabled=False)
        await _set_manifest_capabilities(db, plugin, status="unavailable", actor_id=actor_id, last_error=str(exc))
        plugin.enabled = False
        plugin.status = "error"
        plugin.last_error = str(exc)
        await db.flush()
        # No rollback here: the permission grants and status/error state flushed
        # above are intentional even when the runtime fails to start. The route
        # handler commits this error state so the admin can see why enable failed.
        # See plugins.py enable_installed_plugin for the matching commit-on-error.
        raise PluginLifecycleError(str(exc)) from exc

    return await _get_plugin(db, plugin.key)


async def disable_plugin(db: AsyncSession, plugin_key: str, *, actor_id: int | None) -> Plugin:
    plugin = await _get_plugin(db, plugin_key)
    await stop_plugin_runtime(db, plugin.key)
    await _set_actions_enabled(plugin, enabled=False)
    await _set_manifest_capabilities(db, plugin, status="unavailable", actor_id=actor_id)
    plugin.enabled = False
    plugin.status = "disabled"
    plugin.last_error = None
    await db.flush()
    return await _get_plugin(db, plugin.key)


async def uninstall_plugin(db: AsyncSession, plugin_key: str, *, actor_id: int | None) -> None:
    plugin = await _get_plugin(db, plugin_key)
    await stop_plugin_runtime(db, plugin.key)
    await _set_actions_enabled(plugin, enabled=False)
    await _set_manifest_capabilities(db, plugin, status="unavailable", actor_id=actor_id)
    install_path = _safe_install_path(plugin.install_path)
    await db.execute(update(PluginSuggestion).where(PluginSuggestion.plugin_id == plugin.id).values(plugin_id=None))
    await db.delete(plugin)
    await db.flush()
    shutil.rmtree(install_path, ignore_errors=True)
    try:
        install_path.parent.rmdir()
    except OSError:
        pass


async def stop_all_plugin_runtimes(db: AsyncSession) -> None:
    """Stop all managed plugin processes gracefully. Called during application shutdown.

    The in-memory _processes dict in plugin_runtime_service owns the actual subprocess
    handles. This iterates every enabled plugin key and delegates to stop_plugin_runtime
    so process termination, token cleanup, and DB status updates go through the normal path.
    """
    from sqlalchemy import select as sa_select
    from app.models.plugin import Plugin as _Plugin

    result = await db.execute(sa_select(_Plugin.key).where(_Plugin.enabled.is_(True)))
    keys = list(result.scalars().all())
    for key in keys:
        try:
            await stop_plugin_runtime(db, key, mark_stopped=True)
        except Exception:
            pass
    try:
        await db.commit()
    except Exception:
        pass


async def _get_plugin(db: AsyncSession, plugin_key: str) -> Plugin:
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
    plugin = result.scalar_one_or_none()
    if plugin is None:
        raise PluginLifecycleError(f"Plugin '{plugin_key}' is not installed")
    return plugin


async def _set_actions_enabled(plugin: Plugin, *, enabled: bool) -> None:
    for action in plugin.actions:
        if isinstance(action, PluginAction):
            action.enabled = enabled


async def _set_manifest_capabilities(
    db: AsyncSession,
    plugin: Plugin,
    *,
    status: str,
    actor_id: int | None,
    last_error: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    for raw_capability in (plugin.manifest or {}).get("capabilities") or []:
        if not isinstance(raw_capability, dict):
            continue
        key = str(raw_capability.get("key") or "").strip()
        capability_type = str(raw_capability.get("type") or "").strip()
        if not key or not capability_type:
            continue
        capability = await db.scalar(select(ExtensionCapability).where(ExtensionCapability.key == key))
        if capability is None:
            capability = ExtensionCapability(key=key, created_by=actor_id)
            db.add(capability)
        capability.name = key
        capability.capability_type = capability_type
        capability.status = status
        capability.version = plugin.installed_version
        capability.description = (
            raw_capability.get("description") if isinstance(raw_capability.get("description"), str) else None
        )
        capability.health_url = None
        capability.last_error = last_error
        capability.details = {
            "source": "plugin",
            "pluginKey": plugin.key,
            "pluginVersion": plugin.installed_version,
        }
        capability.updated_by = actor_id
        capability.updated_at = now
        capability.last_seen_at = now


def _safe_install_path(raw_path: str) -> Path:
    storage_root = Path(settings.PLUGIN_STORAGE_PATH).resolve()
    install_path = Path(raw_path).resolve()
    if install_path == storage_root or storage_root not in install_path.parents:
        raise PluginLifecycleError("Plugin install path is outside configured plugin storage")
    return install_path

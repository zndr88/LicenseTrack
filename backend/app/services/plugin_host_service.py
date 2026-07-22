from fastapi import HTTPException

from app.config import settings
from app.models.plugin import Plugin


HOST_DISABLED_DETAIL = "Official Extensions are not available in this deployment"
UNVERIFIED_DETAIL = "Only verified Official Extensions can be enabled"


def plugin_host_enabled() -> bool:
    return bool(settings.PLUGIN_HOST_ENABLED)


def plugin_developer_mode() -> bool:
    return plugin_host_enabled() and bool(settings.PLUGIN_HOST_DEVELOPER_MODE)


def require_plugin_host_enabled() -> None:
    if not plugin_host_enabled():
        raise HTTPException(status_code=404, detail=HOST_DISABLED_DETAIL)


def ensure_plugin_host_enabled() -> None:
    if not plugin_host_enabled():
        raise ValueError(HOST_DISABLED_DETAIL)


def plugin_can_run(plugin: Plugin) -> bool:
    if plugin.trust_status == "verified":
        return True
    return plugin.trust_status == "developer" and plugin_developer_mode()


def ensure_plugin_can_run(plugin: Plugin) -> None:
    ensure_plugin_host_enabled()
    if not plugin_can_run(plugin):
        raise ValueError(UNVERIFIED_DETAIL)

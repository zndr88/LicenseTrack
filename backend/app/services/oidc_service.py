from __future__ import annotations

import asyncio
import importlib.util
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.services.ssrf_guard import check_ssrf

from app.models.settings import GlobalSettings

logger = logging.getLogger(__name__)


def authlib_available() -> bool:
    return importlib.util.find_spec("authlib") is not None


@dataclass
class OIDCMetadata:
    cache_key: str  # "{discovery_url}|{client_id}|{bool(secret)}" - matches _availability_cache format
    discovery: dict[str, Any]
    jwks: dict[str, Any] | None


_metadata_cache: OIDCMetadata | None = None
_availability_cache: tuple[str, bool] | None = None


def invalidate_oidc_cache() -> None:
    global _metadata_cache, _availability_cache
    _metadata_cache = None
    _availability_cache = None


def oidc_is_configured(global_settings: GlobalSettings | None) -> bool:
    if global_settings is None:
        return False
    return bool(
        global_settings.oidc_enabled
        and global_settings.oidc_discovery_url
        and global_settings.oidc_client_id
        and global_settings.oidc_client_secret
    )


async def get_oidc_availability(global_settings: GlobalSettings | None) -> bool:
    global _availability_cache

    if not authlib_available() or not oidc_is_configured(global_settings):
        return False

    cache_key = (
        f"{global_settings.oidc_discovery_url}|"
        f"{global_settings.oidc_client_id}|"
        f"{bool(global_settings.oidc_client_secret)}"
    )
    if _availability_cache and _availability_cache[0] == cache_key:
        return _availability_cache[1]

    try:
        await get_oidc_metadata(global_settings)
        _availability_cache = (cache_key, True)
        return True
    except Exception:
        logger.warning("OIDC metadata fetch failed", exc_info=True)
        _availability_cache = (cache_key, False)
        return False


async def get_oidc_metadata(global_settings: GlobalSettings) -> OIDCMetadata:
    global _metadata_cache

    if not authlib_available():
        raise RuntimeError("authlib is not installed")
    if not oidc_is_configured(global_settings):
        raise RuntimeError("OIDC is not fully configured")

    cache_key = (
        f"{(global_settings.oidc_discovery_url or '').strip()}|"
        f"{global_settings.oidc_client_id}|"
        f"{bool(global_settings.oidc_client_secret)}"
    )
    if _metadata_cache and _metadata_cache.cache_key == cache_key:
        return _metadata_cache

    discovery_url = (global_settings.oidc_discovery_url or "").strip()
    await asyncio.to_thread(check_ssrf, discovery_url)
    async with httpx.AsyncClient(timeout=10.0) as client:
        discovery_response = await client.get(discovery_url)
        discovery_response.raise_for_status()
        discovery = discovery_response.json()
        jwks = None
        if discovery.get("jwks_uri"):
            await asyncio.to_thread(check_ssrf, discovery["jwks_uri"])
            jwks_response = await client.get(discovery["jwks_uri"])
            jwks_response.raise_for_status()
            jwks = jwks_response.json()

    _metadata_cache = OIDCMetadata(
        cache_key=cache_key,
        discovery=discovery,
        jwks=jwks,
    )
    return _metadata_cache

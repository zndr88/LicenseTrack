from __future__ import annotations

import asyncio
import importlib.util
import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse, urlunsplit

import httpx

from app.config import settings as app_settings
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


def validate_oidc_url(url: str, *, purpose: str = "OIDC URL") -> None:
    normalized_url = (url or "").strip()
    parsed = urlparse(normalized_url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError(f"{purpose} must be a valid URL with a resolvable host")
    if parsed.scheme == "https":
        pass
    elif parsed.scheme == "http" and app_settings.ALLOW_HTTP_OIDC_DISCOVERY:
        pass
    else:
        raise ValueError(
            f"{purpose} must use HTTPS unless ALLOW_HTTP_OIDC_DISCOVERY is enabled"
        )
    if not app_settings.ALLOW_PRIVATE_OIDC_DISCOVERY:
        check_ssrf(normalized_url)


def normalize_oidc_issuer(issuer: str) -> str:
    """Validate and canonicalize an issuer URL for stable account binding."""
    normalized = (issuer or "").strip().rstrip("/")
    validate_oidc_url(normalized, purpose="OIDC issuer")
    parsed = urlparse(normalized)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("OIDC issuer must not contain credentials, query parameters, or fragments")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))


def normalize_oidc_email(email: str) -> str:
    return (email or "").strip().casefold()


async def validate_oidc_fetch_url(url: str, *, purpose: str = "OIDC URL") -> None:
    await asyncio.to_thread(validate_oidc_url, url, purpose=purpose)


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
    await validate_oidc_fetch_url(discovery_url, purpose="OIDC discovery URL")
    async with httpx.AsyncClient(timeout=10.0) as client:
        discovery_response = await client.get(discovery_url)
        discovery_response.raise_for_status()
        discovery = discovery_response.json()
        if discovery.get("token_endpoint"):
            await validate_oidc_fetch_url(discovery["token_endpoint"], purpose="OIDC token endpoint")
        if discovery.get("userinfo_endpoint"):
            await validate_oidc_fetch_url(discovery["userinfo_endpoint"], purpose="OIDC userinfo endpoint")
        jwks = None
        if discovery.get("jwks_uri"):
            await validate_oidc_fetch_url(discovery["jwks_uri"], purpose="OIDC JWKS URI")
            jwks_response = await client.get(discovery["jwks_uri"])
            jwks_response.raise_for_status()
            jwks = jwks_response.json()

    _metadata_cache = OIDCMetadata(
        cache_key=cache_key,
        discovery=discovery,
        jwks=jwks,
    )
    return _metadata_cache

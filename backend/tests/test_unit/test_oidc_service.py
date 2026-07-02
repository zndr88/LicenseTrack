"""
Unit tests for app.services.oidc_service.

All outbound HTTP calls are intercepted via pytest-respx so no real IdP
requests are made during the test run.
"""
from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
import respx

import app.services.oidc_service as oidc_module
from app.services.oidc_service import (
    OIDCMetadata,
    authlib_available,
    get_oidc_availability,
    get_oidc_metadata,
    invalidate_oidc_cache,
    oidc_is_configured,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DISCOVERY_URL = "https://idp.example.com/.well-known/openid-configuration"
JWKS_URI = "https://idp.example.com/.well-known/jwks.json"

DISCOVERY_DOC = {
    "issuer": "https://idp.example.com",
    "authorization_endpoint": "https://idp.example.com/auth",
    "token_endpoint": "https://idp.example.com/token",
    "jwks_uri": JWKS_URI,
}

JWKS_DOC = {
    "keys": [{"kty": "RSA", "kid": "1", "n": "abc", "e": "AQAB"}]
}

DISCOVERY_DOC_NO_JWKS = {
    "issuer": "https://idp.example.com",
    "authorization_endpoint": "https://idp.example.com/auth",
    "token_endpoint": "https://idp.example.com/token",
    # deliberately no jwks_uri
}


def make_settings(
    *,
    enabled: bool = True,
    discovery_url: str | None = DISCOVERY_URL,
    client_id: str | None = "my-client",
    client_secret: str | None = "super-secret",
):
    """Return a minimal GlobalSettings-like object (no DB needed)."""
    return SimpleNamespace(
        oidc_enabled=enabled,
        oidc_discovery_url=discovery_url,
        oidc_client_id=client_id,
        oidc_client_secret=client_secret,
    )


@pytest.fixture(autouse=True)
def clear_oidc_caches(monkeypatch):
    """Reset module-level caches before every test for isolation."""
    invalidate_oidc_cache()
    monkeypatch.setattr(oidc_module, "check_ssrf", lambda _url: None)
    yield
    invalidate_oidc_cache()


# ---------------------------------------------------------------------------
# authlib_available
# ---------------------------------------------------------------------------

def test_authlib_available_returns_bool():
    result = authlib_available()
    assert isinstance(result, bool)


def test_authlib_available_false_when_not_installed(monkeypatch):
    monkeypatch.setattr(
        oidc_module.importlib.util,
        "find_spec",
        lambda name: None,
    )
    assert authlib_available() is False


def test_authlib_available_true_when_installed(monkeypatch):
    monkeypatch.setattr(
        oidc_module.importlib.util,
        "find_spec",
        lambda name: object(),  # any truthy object
    )
    assert authlib_available() is True


# ---------------------------------------------------------------------------
# oidc_is_configured
# ---------------------------------------------------------------------------

def test_oidc_is_configured_none_settings():
    assert oidc_is_configured(None) is False


def test_oidc_is_configured_disabled():
    settings = make_settings(enabled=False)
    assert oidc_is_configured(settings) is False


def test_oidc_is_configured_missing_discovery_url():
    settings = make_settings(discovery_url=None)
    assert oidc_is_configured(settings) is False


def test_oidc_is_configured_missing_client_id():
    settings = make_settings(client_id=None)
    assert oidc_is_configured(settings) is False


def test_oidc_is_configured_missing_client_secret():
    settings = make_settings(client_secret=None)
    assert oidc_is_configured(settings) is False


def test_oidc_is_configured_fully_configured():
    settings = make_settings()
    assert oidc_is_configured(settings) is True


# ---------------------------------------------------------------------------
# invalidate_oidc_cache
# ---------------------------------------------------------------------------

def test_invalidate_oidc_cache_clears_both_caches():
    # Seed the module-level cache variables
    oidc_module._metadata_cache = OIDCMetadata(
        cache_key="k",
        discovery={"issuer": "x"},
        jwks=None,
    )
    oidc_module._availability_cache = ("k", True)

    invalidate_oidc_cache()

    assert oidc_module._metadata_cache is None
    assert oidc_module._availability_cache is None


# ---------------------------------------------------------------------------
# get_oidc_metadata — error paths
# ---------------------------------------------------------------------------

async def test_get_oidc_metadata_raises_when_authlib_missing(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: False)
    settings = make_settings()
    with pytest.raises(RuntimeError, match="authlib is not installed"):
        await get_oidc_metadata(settings)


async def test_get_oidc_metadata_raises_when_not_configured(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)
    settings = make_settings(enabled=False)
    with pytest.raises(RuntimeError, match="OIDC is not fully configured"):
        await get_oidc_metadata(settings)


# ---------------------------------------------------------------------------
# get_oidc_metadata — cache hit
# ---------------------------------------------------------------------------

async def test_get_oidc_metadata_returns_cached_value(monkeypatch):
    """If _metadata_cache key matches, no HTTP call is made."""
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)
    settings = make_settings()

    expected_key = (
        f"{DISCOVERY_URL}|"
        f"my-client|"
        f"{bool('super-secret')}"
    )
    cached = OIDCMetadata(
        cache_key=expected_key,
        discovery={"cached": True},
        jwks=None,
    )
    oidc_module._metadata_cache = cached

    result = await get_oidc_metadata(settings)
    assert result is cached  # returned the exact same object — no HTTP


# ---------------------------------------------------------------------------
# get_oidc_metadata — successful fetch with jwks_uri
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_metadata_fetches_discovery_and_jwks(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(200, json=DISCOVERY_DOC)
    )
    respx.get(JWKS_URI).mock(
        return_value=httpx.Response(200, json=JWKS_DOC)
    )

    settings = make_settings()
    result = await get_oidc_metadata(settings)

    assert isinstance(result, OIDCMetadata)
    assert result.discovery == DISCOVERY_DOC
    assert result.jwks == JWKS_DOC
    # Module cache should be populated
    assert oidc_module._metadata_cache is result


# ---------------------------------------------------------------------------
# get_oidc_metadata — successful fetch WITHOUT jwks_uri
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_metadata_no_jwks_uri_leaves_jwks_none(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(200, json=DISCOVERY_DOC_NO_JWKS)
    )

    settings = make_settings()
    result = await get_oidc_metadata(settings)

    assert result.discovery == DISCOVERY_DOC_NO_JWKS
    assert result.jwks is None


# ---------------------------------------------------------------------------
# get_oidc_metadata — HTTP error propagates
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_metadata_raises_on_http_error(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(503)
    )

    settings = make_settings()
    with pytest.raises(httpx.HTTPStatusError):
        await get_oidc_metadata(settings)


# ---------------------------------------------------------------------------
# get_oidc_metadata — discovery URL is stripped
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_metadata_strips_whitespace_from_url(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(200, json=DISCOVERY_DOC_NO_JWKS)
    )

    settings = make_settings(discovery_url=f"  {DISCOVERY_URL}  ")
    result = await get_oidc_metadata(settings)
    assert result.discovery == DISCOVERY_DOC_NO_JWKS


# ---------------------------------------------------------------------------
# get_oidc_availability — authlib not available
# ---------------------------------------------------------------------------

async def test_get_oidc_availability_false_when_authlib_missing(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: False)
    assert await get_oidc_availability(make_settings()) is False


# ---------------------------------------------------------------------------
# get_oidc_availability — settings not configured
# ---------------------------------------------------------------------------

async def test_get_oidc_availability_false_when_not_configured(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)
    assert await get_oidc_availability(None) is False


# ---------------------------------------------------------------------------
# get_oidc_availability — cache hit (True)
# ---------------------------------------------------------------------------

async def test_get_oidc_availability_returns_cached_true(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)
    settings = make_settings()
    cache_key = (
        f"{DISCOVERY_URL}|"
        f"my-client|"
        f"{bool('super-secret')}"
    )
    oidc_module._availability_cache = (cache_key, True)

    result = await get_oidc_availability(settings)
    assert result is True


# ---------------------------------------------------------------------------
# get_oidc_availability — cache hit (False)
# ---------------------------------------------------------------------------

async def test_get_oidc_availability_returns_cached_false(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)
    settings = make_settings()
    cache_key = (
        f"{DISCOVERY_URL}|"
        f"my-client|"
        f"{bool('super-secret')}"
    )
    oidc_module._availability_cache = (cache_key, False)

    result = await get_oidc_availability(settings)
    assert result is False


# ---------------------------------------------------------------------------
# get_oidc_availability — metadata fetch succeeds → True + populates cache
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_availability_true_on_successful_fetch(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(200, json=DISCOVERY_DOC)
    )
    respx.get(JWKS_URI).mock(
        return_value=httpx.Response(200, json=JWKS_DOC)
    )

    result = await get_oidc_availability(make_settings())
    assert result is True
    assert oidc_module._availability_cache is not None
    assert oidc_module._availability_cache[1] is True


# ---------------------------------------------------------------------------
# get_oidc_availability — metadata fetch fails → False + populates cache
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_availability_false_on_failed_fetch(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(503)
    )

    result = await get_oidc_availability(make_settings())
    assert result is False
    assert oidc_module._availability_cache is not None
    assert oidc_module._availability_cache[1] is False


# ---------------------------------------------------------------------------
# get_oidc_availability — different cache key forces re-fetch
# ---------------------------------------------------------------------------

@respx.mock
async def test_get_oidc_availability_refetches_on_key_mismatch(monkeypatch):
    monkeypatch.setattr(oidc_module, "authlib_available", lambda: True)

    # Seed with a *different* key
    oidc_module._availability_cache = ("stale-key|old|True", True)

    respx.get(DISCOVERY_URL).mock(
        return_value=httpx.Response(200, json=DISCOVERY_DOC_NO_JWKS)
    )

    result = await get_oidc_availability(make_settings())
    assert result is True
    # Cache should now hold the new key
    assert oidc_module._availability_cache[0] != "stale-key|old|True"

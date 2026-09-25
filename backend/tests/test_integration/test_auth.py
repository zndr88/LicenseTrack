"""
Integration tests for authentication routes.
"""

import importlib.util
import logging
import asyncio
import time

import bcrypt
import httpx
import pytest
import respx
from joserfc import jwk
from joserfc import jwt as joserfc_jwt
from sqlalchemy import select

import app.routes.auth as auth_module
import app.routes.auth_oidc as auth_oidc_module
from app import auth as _app_auth
from app.models.settings import GlobalSettings
from app.models.human_session import HumanSession
from app.models.user import AuthProvider, User, UserRole
from app.services import oidc_service
from app.services.settings_service import invalidate_global_settings_cache


HAS_AUTHLIB = importlib.util.find_spec("authlib") is not None and importlib.util.find_spec("respx") is not None

# ── OIDC callback test helpers ────────────────────────────────────────────────

_ISSUER = "https://idp.example.com"
_CLIENT_ID = "test-client-id"
_CLIENT_SECRET = "test-client-secret"
_DISCOVERY_URL = f"{_ISSUER}/.well-known/openid-configuration"
_TOKEN_ENDPOINT = f"{_ISSUER}/token"
_JWKS_URI = f"{_ISSUER}/jwks"

_DISCOVERY_DOC = {
    "issuer": _ISSUER,
    "authorization_endpoint": f"{_ISSUER}/auth",
    "token_endpoint": _TOKEN_ENDPOINT,
    "jwks_uri": _JWKS_URI,
}

# RSA key pair generated once at module import — signs and verifies test ID tokens.
_TEST_PRIVATE_JWK = jwk.generate_key("RSA", 2048, private=True)
_full_jwk = _TEST_PRIVATE_JWK.as_dict(private=False)
# Only public components go in the mocked JWKS response.
_TEST_JWKS = {"keys": [{"kty": _full_jwk["kty"], "n": _full_jwk["n"], "e": _full_jwk["e"], "alg": "RS256", "use": "sig"}]}


def _build_id_token(email: str, nonce: str, **claim_overrides) -> str:
    """Return a signed RS256 ID token for the given email and nonce."""
    now = int(time.time())
    payload = {
        "iss": _ISSUER,
        "aud": _CLIENT_ID,
        "sub": f"oidc|{email}",
        "email": email,
        "nonce": nonce,
        "iat": now,
        "exp": now + 3600,
    }
    payload.update(claim_overrides)
    return joserfc_jwt.encode({"alg": "RS256"}, payload, _TEST_PRIVATE_JWK)


async def _add_oidc_settings(db_session) -> None:
    """Insert a fully-configured OIDC GlobalSettings row and invalidate the service cache."""
    db_session.add(GlobalSettings(
        id=1,
        oidc_enabled=True,
        oidc_discovery_url=_DISCOVERY_URL,
        oidc_client_id=_CLIENT_ID,
        oidc_client_secret=_CLIENT_SECRET,
    ))
    await db_session.commit()
    invalidate_global_settings_cache()
    oidc_service.invalidate_oidc_cache()


def _flow_cookie(state: str, nonce: str) -> str:
    """Return a signed OIDC flow cookie value for the given state/nonce pair."""
    return _app_auth.build_oidc_flow_cookie(state, nonce)


@pytest.fixture(autouse=True)
def reset_rate_limiter(monkeypatch):
    auth_module._login_attempts_by_user.clear()
    auth_module._login_attempts_by_ip.clear()
    auth_oidc_module._oidc_attempts.clear()
    monkeypatch.setattr(oidc_service, "check_ssrf", lambda _url: None)
    yield
    auth_module._login_attempts_by_user.clear()
    auth_module._login_attempts_by_ip.clear()
    auth_oidc_module._oidc_attempts.clear()


def _make_user(
    username: str,
    password: str,
    role: UserRole = UserRole.admin,
    auth_provider: AuthProvider = AuthProvider.local,
) -> User:
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    return User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=hashed,
        role=role,
        auth_provider=auth_provider,
        is_active=True,
        must_change_password=False,
    )


async def test_login_success_sets_cookie_and_returns_user_shape(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("loginuser", password, UserRole.admin))
    await db_session.commit()

    resp = await test_app.post("/api/auth/login", json={"username": "loginuser", "password": password})

    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["role"] == "admin"
    assert data["user"]["auth_provider"] == "local"
    assert "set-cookie" in resp.headers


async def test_cookie_auth_bootstraps_me(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("cookieuser", password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post("/api/auth/login", json={"username": "cookieuser", "password": password})
    assert login_resp.status_code == 200

    me_resp = await test_app.get("/api/users/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "cookieuser"


async def test_session_probe_returns_anonymous_without_cookie(test_app):
    resp = await test_app.get("/api/auth/session")

    assert resp.status_code == 200
    assert resp.json() == {
        "authenticated": False,
        "user": None,
        "expires_at": None,
        "coordination_id": None,
        "session_timeout": None,
    }


async def test_session_probe_returns_user_with_cookie(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("sessionuser", password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post("/api/auth/login", json={"username": "sessionuser", "password": password})
    assert login_resp.status_code == 200

    session_resp = await test_app.get("/api/auth/session")
    assert session_resp.status_code == 200
    data = session_resp.json()
    assert data["authenticated"] is True
    assert data["user"]["username"] == "sessionuser"


async def test_session_refresh_rotates_active_human_session(db_session, test_app, monkeypatch):
    password = "correctpassword123"
    db_session.add_all([
        _make_user("refreshuser", password, UserRole.admin),
        GlobalSettings(id=1, session_timeout=30),
    ])
    await db_session.commit()
    invalidate_global_settings_cache()

    login_resp = await test_app.post("/api/auth/login", json={"username": "refreshuser", "password": password})
    assert login_resp.status_code == 200

    original_create_access_token = auth_module.auth.create_access_token
    issued_with: list[int | None] = []

    def capture_lifetime(user_id, role, *, security_version=0, lifetime_minutes=None, session_id=None):
        issued_with.append(lifetime_minutes)
        return original_create_access_token(
            user_id,
            role,
            security_version=security_version,
            lifetime_minutes=lifetime_minutes,
            session_id=session_id,
        )

    monkeypatch.setattr(auth_module.auth, "create_access_token", capture_lifetime)
    refresh_resp = await test_app.post("/api/auth/refresh")

    assert refresh_resp.status_code == 200
    assert refresh_resp.json()["access_token"]
    assert refresh_resp.json()["token_type"] == "bearer"
    assert issued_with == [30]
    assert "set-cookie" not in refresh_resp.headers


async def test_session_refresh_requires_authentication(test_app):
    test_app.cookies.clear()

    refresh_resp = await test_app.post("/api/auth/refresh")

    assert refresh_resp.status_code == 401


async def test_logout_revokes_session_without_mutating_cookie(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("logoutuser", password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post("/api/auth/login", json={"username": "logoutuser", "password": password})
    assert login_resp.status_code == 200

    logout_resp = await test_app.post("/api/auth/logout")
    assert logout_resp.status_code == 204
    assert logout_resp.content == b""
    assert "set-cookie" not in logout_resp.headers
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is False


async def test_change_password_rotates_session_and_invalidates_old_token(db_session, test_app):
    old_password = "oldpassword123"
    new_password = "newpassword123"
    db_session.add(_make_user("changepwuser", old_password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "changepwuser", "password": old_password},
    )
    assert login_resp.status_code == 200
    old_token = login_resp.json()["access_token"]

    change_resp = await test_app.post(
        "/api/auth/change-password",
        json={"current_password": old_password, "new_password": new_password},
    )

    assert change_resp.status_code == 200
    new_token = change_resp.json()["access_token"]
    assert new_token != old_token
    assert (
        await test_app.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {old_token}"},
        )
    ).status_code == 401
    assert (
        await test_app.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {new_token}"},
        )
    ).status_code == 200
    relogin_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "changepwuser", "password": new_password},
    )
    assert relogin_resp.status_code == 200


async def test_forced_password_user_is_limited_to_session_and_password_change(
    db_session,
    test_app,
):
    password = "temporarypassword123"
    user = _make_user("forcedchange", password, UserRole.admin)
    user.must_change_password = True
    db_session.add(user)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": user.username, "password": password},
    )
    assert login_resp.status_code == 200
    assert (await test_app.get("/api/auth/session")).status_code == 200
    blocked = await test_app.get("/api/licenses")
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "Password change required before using this endpoint"


async def test_inactive_local_user_cannot_log_in(db_session, test_app):
    user = _make_user("inactiveuser", "correctpassword123", UserRole.admin)
    user.is_active = False
    db_session.add(user)
    await db_session.commit()

    response = await test_app.post(
        "/api/auth/login",
        json={"username": user.username, "password": "correctpassword123"},
    )

    assert response.status_code == 401


async def test_oidc_user_cannot_use_local_login(db_session, test_app):
    user = _make_user("oidcuser", "unusedpassword", auth_provider=AuthProvider.oidc)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.post("/api/auth/login", json={"username": "oidcuser", "password": "anything"})
    assert resp.status_code == 400


async def test_wrong_password_returns_401(db_session, test_app):
    db_session.add(_make_user("authuser", "correctpass"))
    await db_session.commit()

    resp = await test_app.post("/api/auth/login", json={"username": "authuser", "password": "wrongpass"})
    assert resp.status_code == 401


async def test_rate_limit_after_five_failures(test_app):
    for _ in range(5):
        resp = await test_app.post("/api/auth/login", json={"username": "ratelimituser", "password": "wrong"})
        assert resp.status_code == 401

    resp = await test_app.post("/api/auth/login", json={"username": "ratelimituser", "password": "wrong"})
    assert resp.status_code == 429


async def test_password_spray_across_usernames_blocked_by_ip(test_app):
    """A spray of distinct usernames from one IP is throttled by the per-IP limit,
    even though no single username reaches its own per-username threshold."""
    last_status = None
    for i in range(auth_module._MAX_ATTEMPTS_PER_IP + 5):
        resp = await test_app.post(
            "/api/auth/login",
            json={"username": f"spray_user_{i}", "password": "wrong"},
        )
        last_status = resp.status_code
    assert last_status == 429


async def test_successful_login_clears_username_counter_but_preserves_ip_counter(db_session, test_app):
    """A successful login clears that account's typo history without resetting
    the source-IP spray limiter for other usernames."""
    password = "correctpassword123"
    db_session.add(_make_user("clearcounter", password, UserRole.admin))
    await db_session.commit()

    for _ in range(3):
        bad = await test_app.post("/api/auth/login", json={"username": "clearcounter", "password": "wrong"})
        assert bad.status_code == 401

    ok = await test_app.post("/api/auth/login", json={"username": "clearcounter", "password": password})
    assert ok.status_code == 200

    # Counter cleared: a subsequent wrong attempt is a plain 401, not a 429.
    again = await test_app.post("/api/auth/login", json={"username": "clearcounter", "password": "wrong"})
    assert again.status_code == 401


async def test_successful_login_does_not_reset_ip_spray_counter(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("sprayclear", password, UserRole.viewer))
    await db_session.commit()

    for i in range(auth_module._MAX_ATTEMPTS_PER_IP - 1):
        resp = await test_app.post(
            "/api/auth/login",
            json={"username": f"spray_clear_{i}", "password": "wrong"},
        )
        assert resp.status_code == 401

    ok = await test_app.post("/api/auth/login", json={"username": "sprayclear", "password": password})
    assert ok.status_code == 200

    last_allowed = await test_app.post(
        "/api/auth/login",
        json={"username": "spray_clear_last", "password": "wrong"},
    )
    assert last_allowed.status_code == 401

    blocked = await test_app.post(
        "/api/auth/login",
        json={"username": "spray_clear_blocked", "password": "wrong"},
    )
    assert blocked.status_code == 429


def test_login_attempt_key_cap_evicts_active_oldest_entries(monkeypatch):
    monkeypatch.setattr(auth_module, "_MAX_TRACKED_KEYS", 2)
    auth_module._login_attempts_by_user["oldest"] = [time.time()]
    auth_module._login_attempts_by_user["middle"] = [time.time()]
    auth_module._login_attempts_by_user["newest"] = [time.time()]

    assert "oldest" in auth_module._login_attempts_by_user

    auth_module._check_rate_limit("incoming", None)

    assert "oldest" not in auth_module._login_attempts_by_user
    assert len(auth_module._login_attempts_by_user) <= 2


async def test_nonexistent_user_returns_401_not_error(test_app):
    """An unknown username fails closed with 401 (timing-equalised dummy verify)."""
    resp = await test_app.post("/api/auth/login", json={"username": "ghost", "password": "whatever"})
    assert resp.status_code == 401


async def test_auth_mode_includes_oidc_flags(db_session, test_app):
    db_session.add(GlobalSettings(id=1, oidc_enabled=True))
    await db_session.commit()

    resp = await test_app.get("/api/auth/mode")
    assert resp.status_code == 200
    data = resp.json()
    assert "oidc_enabled" in data
    assert "oidc_available" in data


async def test_oidc_login_unavailable_redirects_to_safe_return_target(test_app, monkeypatch):
    monkeypatch.setattr(auth_oidc_module.auth.settings, "CORS_ORIGINS", "http://localhost:5173")

    resp = await test_app.get(
        "/api/auth/oidc/login",
        headers={"referer": "http://localhost:5173/license-lifecycle/login"},
        follow_redirects=False,
    )

    assert resp.status_code == 302
    assert resp.headers["location"] == "http://localhost:5173/?error=oidc_unavailable"
    assert _app_auth.OIDC_FLOW_COOKIE in "\n".join(resp.headers.get_list("set-cookie"))


def test_oidc_frontend_redirect_uses_configured_origin(monkeypatch):
    monkeypatch.setattr(auth_oidc_module.auth.settings, "CORS_ORIGINS", "http://localhost:5173,http://localhost:8080")

    safe_target = auth_oidc_module._frontend_redirect_url("oidc_failed")

    assert safe_target == "http://localhost:5173/?error=oidc_failed"


def test_oidc_frontend_redirect_omits_error_when_not_provided(monkeypatch):
    monkeypatch.setattr(auth_oidc_module.auth.settings, "CORS_ORIGINS", "http://localhost:5173,http://localhost:8080")

    safe_target = auth_oidc_module._frontend_redirect_url()

    assert safe_target == "http://localhost:5173/"


async def test_unauthenticated_access_rejected(test_app):
    resp = await test_app.get("/api/licenses")
    assert resp.status_code == 401


async def test_bcrypt_72_byte_truncation(db_session, test_app):
    short = "a" * 72
    long_same = "a" * 72 + "different_suffix"
    hashed = bcrypt.hashpw(short.encode()[:72], bcrypt.gensalt()).decode()
    user = User(
        username="truncuser",
        email="truncuser@test.local",
        hashed_password=hashed,
        role=UserRole.admin,
        auth_provider=AuthProvider.local,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp_short = await test_app.post("/api/auth/login", json={"username": "truncuser", "password": short})
    assert resp_short.status_code == 200

    resp_long = await test_app.post("/api/auth/login", json={"username": "truncuser", "password": long_same})
    assert resp_long.status_code == 200


async def test_oidc_callback_oidc_user_match(db_session, test_app):
    """Valid token for an OIDC user: session cookie set, clean redirect."""
    await _add_oidc_settings(db_session)

    user = User(
        username="oidcssouser",
        email="oidcssouser@test.local",
        hashed_password=bcrypt.hashpw(b"unused"[:72], bcrypt.gensalt()).decode(),
        auth_provider=AuthProvider.oidc,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    state = "valid-state-oidc-match"
    nonce = "valid-nonce-oidc-match"
    id_tok = _build_id_token("oidcssouser@test.local", nonce)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
        mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
        mock.post(_TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json={
            "access_token": "mock-access-token",
            "token_type": "bearer",
            "id_token": id_tok,
        }))

        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
        resp = await test_app.get(
            f"/api/auth/oidc/callback?state={state}&code=test-code",
        )

    assert resp.status_code == 302
    assert "error" not in resp.headers.get("location", "")
    all_cookies = "\n".join(resp.headers.get_list("set-cookie"))
    assert _app_auth.settings.SESSION_COOKIE_NAME in all_cookies
    await db_session.refresh(user)
    assert user.oidc_issuer == _ISSUER
    assert user.oidc_subject == "oidc|oidcssouser@test.local"
    assert await db_session.scalar(select(HumanSession).where(HumanSession.user_id == user.id))


@pytest.mark.parametrize(
    ("claim_overrides", "expected_stage"),
    [
        ({"email_verified": False}, "email_not_verified"),
        ({"aud": [_CLIENT_ID, "another-client"]}, "invalid_authorized_party"),
    ],
)
async def test_oidc_callback_rejects_untrusted_identity_claims(
    db_session,
    test_app,
    caplog,
    claim_overrides,
    expected_stage,
):
    caplog.set_level(logging.WARNING, logger="app.routes.auth_oidc")
    await _add_oidc_settings(db_session)
    db_session.add(_make_user("claimuser", "unused", auth_provider=AuthProvider.oidc))
    await db_session.commit()
    state = f"state-{expected_stage}"
    nonce = f"nonce-{expected_stage}"
    id_token = _build_id_token("claimuser@test.local", nonce, **claim_overrides)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
        mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
        mock.post(_TOKEN_ENDPOINT).mock(
            return_value=httpx.Response(
                200,
                json={"access_token": "mock-access-token", "id_token": id_token},
            )
        )
        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
        response = await test_app.get(
            f"/api/auth/oidc/callback?state={state}&code=test-code"
        )

    assert response.status_code == 302
    assert "error=oidc_failed" in response.headers["location"]
    assert f"stage={expected_stage}" in caplog.text


async def test_oidc_callback_local_account_match(db_session, test_app, caplog):
    """Token email matches a local user: redirect with error=local_account, no session cookie."""
    caplog.set_level(logging.WARNING, logger="app.routes.auth_oidc")
    await _add_oidc_settings(db_session)

    user = User(
        username="localusersso",
        email="localusersso@test.local",
        hashed_password=bcrypt.hashpw(b"password"[:72], bcrypt.gensalt()).decode(),
        auth_provider=AuthProvider.local,
        role=UserRole.admin,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    state = "valid-state-local-match"
    nonce = "valid-nonce-local-match"
    id_tok = _build_id_token("localusersso@test.local", nonce)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
        mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
        mock.post(_TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json={
            "access_token": "mock-access-token",
            "token_type": "bearer",
            "id_token": id_tok,
        }))

        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
        resp = await test_app.get(
            f"/api/auth/oidc/callback?state={state}&code=test-code",
        )

    assert resp.status_code == 302
    assert "error=local_account" in resp.headers.get("location", "")
    all_cookies = "\n".join(resp.headers.get_list("set-cookie"))
    assert _app_auth.settings.SESSION_COOKIE_NAME + "=" not in all_cookies
    assert "stage=local_account" in caplog.text
    assert _CLIENT_SECRET not in caplog.text


async def test_oidc_callback_unexpected_failure_logs_callback_failed(
    db_session,
    test_app,
    caplog,
    monkeypatch,
):
    """Unexpected post-validation failures use a generic callback stage."""
    caplog.set_level(logging.WARNING, logger="app.routes.auth_oidc")
    await _add_oidc_settings(db_session)

    user = User(
        username="oidcunexpected",
        email="oidcunexpected@test.local",
        hashed_password=bcrypt.hashpw(b"unused"[:72], bcrypt.gensalt()).decode(),
        auth_provider=AuthProvider.oidc,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    async def failing_log_event(*_args, **_kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(auth_oidc_module, "log_event", failing_log_event)

    state = "valid-state-callback-failed"
    nonce = "valid-nonce-callback-failed"
    id_tok = _build_id_token("oidcunexpected@test.local", nonce)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
        mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
        mock.post(_TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json={
            "access_token": "mock-access-token",
            "token_type": "bearer",
            "id_token": id_tok,
        }))

        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
        resp = await test_app.get(
            f"/api/auth/oidc/callback?state={state}&code=test-code",
        )

    assert resp.status_code == 302
    assert "error=oidc_failed" in resp.headers.get("location", "")
    all_cookies = "\n".join(resp.headers.get_list("set-cookie"))
    assert _app_auth.settings.SESSION_COOKIE_NAME + "=" not in all_cookies
    assert "stage=callback_failed" in caplog.text
    assert "stage=invalid_claims" not in caplog.text
    assert "test-code" not in caplog.text
    assert _CLIENT_SECRET not in caplog.text


async def test_oidc_callback_not_provisioned(db_session, test_app):
    """Token email has no matching user: redirect with error=not_provisioned, no session cookie."""
    await _add_oidc_settings(db_session)

    state = "valid-state-not-provisioned"
    nonce = "valid-nonce-not-provisioned"
    id_tok = _build_id_token("unknown@test.local", nonce)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
        mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
        mock.post(_TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json={
            "access_token": "mock-access-token",
            "token_type": "bearer",
            "id_token": id_tok,
        }))

        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
        resp = await test_app.get(
            f"/api/auth/oidc/callback?state={state}&code=test-code",
        )

    assert resp.status_code == 302
    assert "error=not_provisioned" in resp.headers.get("location", "")
    all_cookies = "\n".join(resp.headers.get_list("set-cookie"))
    assert _app_auth.settings.SESSION_COOKIE_NAME + "=" not in all_cookies


async def test_oidc_callback_invalid_state(db_session, test_app, caplog):
    """Tampered state param: redirect with error=oidc_failed, no IdP calls made."""
    caplog.set_level(logging.WARNING, logger="app.routes.auth_oidc")
    await _add_oidc_settings(db_session)

    state_in_cookie = "real-state-value"
    nonce = "valid-nonce-invalid-state"

    with respx.mock(assert_all_called=False):
        test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state_in_cookie, nonce), path="/")
        resp = await test_app.get(
            "/api/auth/oidc/callback?state=tampered-state&code=test-code",
        )

    assert resp.status_code == 302
    assert "error=oidc_failed" in resp.headers.get("location", "")
    all_cookies = "\n".join(resp.headers.get_list("set-cookie"))
    assert _app_auth.settings.SESSION_COOKIE_NAME + "=" not in all_cookies
    assert "stage=invalid_state" in caplog.text
    assert "test-code" not in caplog.text


async def test_logout_revokes_original_and_refreshed_bearers(db_session, test_app):
    db_session.add(_make_user("revokeduser", "correctpassword123", UserRole.admin))
    await db_session.commit()
    login = await test_app.post("/api/auth/login", json={"username": "revokeduser", "password": "correctpassword123"})
    refreshed = await test_app.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert (await test_app.post("/api/auth/logout")).status_code == 204
    for token in (login.json()["access_token"], refreshed.json()["access_token"]):
        assert (await test_app.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})).status_code == 401
        assert (
            await test_app.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
        ).status_code == 401


async def test_cookie_lifetime_matches_configured_session(db_session, test_app):
    db_session.add_all(
        [_make_user("longsession", "correctpassword123", UserRole.viewer), GlobalSettings(id=1, session_timeout=2880)]
    )
    await db_session.commit()
    invalidate_global_settings_cache()
    login = await test_app.post("/api/auth/login", json={"username": "longsession", "password": "correctpassword123"})
    assert login.status_code == 200
    assert "Max-Age=" not in login.headers["set-cookie"]
    assert "HttpOnly" in login.headers["set-cookie"]
    session = await test_app.get("/api/auth/session")
    assert session.json()["expires_at"] == _app_auth.decode_access_token(login.json()["access_token"])["exp"]
    public = await test_app.get("/api/settings/global/public")
    assert public.json()["session_timeout"] == 2880


@pytest.mark.parametrize("operation", ["refresh", "logout"])
async def test_late_auth_response_preserves_new_login_cookie(db_session, test_app, monkeypatch, operation):
    db_session.add(_make_user("ordereduser", "correctpassword123", UserRole.admin))
    await db_session.commit()
    credentials = {"username": "ordereduser", "password": "correctpassword123"}
    old_login = await test_app.post("/api/auth/login", json=credentials)
    old_token = old_login.json()["access_token"]
    started = asyncio.Event()
    release = asyncio.Event()
    name = "refresh_session_token" if operation == "refresh" else "revoke_session"
    original = getattr(auth_module, name)

    async def delayed(*args, **kwargs):
        if operation == "refresh":
            result = await original(*args, **kwargs)
            started.set()
            await release.wait()
            return result
        started.set()
        await release.wait()
        return await original(*args, **kwargs)

    monkeypatch.setattr(auth_module, name, delayed)
    pending = asyncio.create_task(test_app.post(f"/api/auth/{operation}"))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        if operation == "refresh":
            assert (await test_app.post("/api/auth/logout")).status_code == 204
        new_login = await test_app.post("/api/auth/login", json=credentials)
        assert new_login.status_code == 200
        new_cookie = test_app.cookies.get(_app_auth.settings.SESSION_COOKIE_NAME)
        release.set()
        late = await asyncio.wait_for(pending, timeout=5)
        assert late.status_code == (200 if operation == "refresh" else 204)
        assert "set-cookie" not in late.headers
        assert test_app.cookies.get(_app_auth.settings.SESSION_COOKIE_NAME) == new_cookie
        assert (await test_app.get("/api/users/me")).status_code == 200
        new_token = new_login.json()["access_token"]
        assert (await test_app.get("/api/users/me", headers={"Authorization": f"Bearer {new_token}"})).status_code == 200
        if operation in {"logout", "refresh"}:
            assert (await test_app.get("/api/users/me", headers={"Authorization": f"Bearer {old_token}"})).status_code == 401
    finally:
        release.set()
        await pending


async def test_logout_preserves_another_device_session(db_session, test_app):
    db_session.add(_make_user("devicesuser", "correctpassword123", UserRole.admin))
    await db_session.commit()
    credentials = {"username": "devicesuser", "password": "correctpassword123"}
    laptop = (await test_app.post("/api/auth/login", json=credentials)).json()["access_token"]
    desktop = (await test_app.post("/api/auth/login", json=credentials)).json()["access_token"]
    assert (await test_app.post("/api/auth/logout", headers={"Authorization": f"Bearer {laptop}"})).status_code == 204
    assert (await test_app.get("/api/users/me")).status_code == 200
    assert (await test_app.post("/api/auth/refresh", headers={"Authorization": f"Bearer {desktop}"})).status_code == 200
    assert (await test_app.post("/api/auth/refresh", headers={"Authorization": f"Bearer {laptop}"})).status_code == 401


async def test_stable_cookie_uses_server_expiry(db_session, test_app):
    from app.models.human_session import HumanSession
    db_session.add(_make_user("expiryuser", "correctpassword123", UserRole.admin))
    await db_session.commit()
    login = await test_app.post("/api/auth/login", json={"username": "expiryuser", "password": "correctpassword123"})
    sid = _app_auth.decode_access_token(login.json()["access_token"])["session_id"]
    session = await db_session.get(HumanSession, sid)
    session.expires_at = int(time.time()) - 1
    await db_session.commit()
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is False
    assert (await test_app.get("/api/users/me")).status_code == 401


async def test_legacy_human_tokens_require_a_fresh_login(db_session, test_app):
    user = _make_user("legacyuser", "correctpassword123", UserRole.admin)
    db_session.add(user)
    await db_session.commit()
    token = _app_auth.create_access_token(user.id, user.role, security_version=user.security_version)
    test_app.cookies.set(_app_auth.settings.SESSION_COOKIE_NAME, token)
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is False
    headers = {"Authorization": f"Bearer {token}"}
    assert (await test_app.get("/api/users/me", headers=headers)).status_code == 401
    assert (await test_app.post("/api/auth/refresh", headers=headers)).status_code == 401


async def test_legacy_human_token_cannot_authenticate_a_reused_user_id(db_session, test_app):
    original = _make_user("deleteduser", "correctpassword123", UserRole.admin)
    db_session.add(original)
    await db_session.commit()
    legacy_token = _app_auth.create_access_token(
        original.id,
        original.role,
        security_version=original.security_version,
    )
    original_id = original.id
    await db_session.delete(original)
    await db_session.commit()

    replacement = _make_user("replacementuser", "correctpassword123", UserRole.viewer)
    replacement.id = original_id
    db_session.add(replacement)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {legacy_token}"}
    assert (await test_app.get("/api/users/me", headers=headers)).status_code == 401
    assert (await test_app.post("/api/auth/refresh", headers=headers)).status_code == 401


async def test_successful_oidc_logins_do_not_consume_the_rate_limit(db_session, test_app):
    await _add_oidc_settings(db_session)
    user = User(
        username="ssoburst",
        email="ssoburst@test.local",
        hashed_password=bcrypt.hashpw(b"unused"[:72], bcrypt.gensalt()).decode(),
        auth_provider=AuthProvider.oidc,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    for attempt in range(12):
        state = f"burst-state-{attempt}"
        nonce = f"burst-nonce-{attempt}"
        with respx.mock(assert_all_called=False) as mock:
            mock.get(_DISCOVERY_URL).mock(return_value=httpx.Response(200, json=_DISCOVERY_DOC))
            mock.get(_JWKS_URI).mock(return_value=httpx.Response(200, json=_TEST_JWKS))
            mock.post(_TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json={
                "access_token": "mock-access-token",
                "token_type": "bearer",
                "id_token": _build_id_token("ssoburst@test.local", nonce),
            }))
            test_app.cookies.set(_app_auth.OIDC_FLOW_COOKIE, _flow_cookie(state, nonce), path="/")
            resp = await test_app.get(f"/api/auth/oidc/callback?state={state}&code=c{attempt}")
        assert resp.status_code == 302, f"attempt {attempt} got {resp.status_code}"
        assert "error" not in resp.headers.get("location", "")


async def test_failed_oidc_callbacks_still_rate_limited(db_session, test_app):
    await _add_oidc_settings(db_session)
    statuses = []
    for attempt in range(11):
        resp = await test_app.get(f"/api/auth/oidc/callback?state=missing-cookie-{attempt}&code=x")
        statuses.append(resp.status_code)
    assert statuses[:10] == [302] * 10
    assert statuses[10] == 429


async def test_concurrent_oidc_callbacks_cannot_exceed_the_rate_limit(db_session, test_app, monkeypatch):
    runs = 0

    async def slow_failed_callback(request, db):
        nonlocal runs
        runs += 1
        await asyncio.sleep(0.05)
        return auth_oidc_module._login_redirect("oidc_failed")

    monkeypatch.setattr(auth_oidc_module, "_oidc_callback_response", slow_failed_callback)
    responses = await asyncio.gather(*(
        test_app.get(f"/api/auth/oidc/callback?state=parallel-{attempt}&code=x")
        for attempt in range(20)
    ))
    statuses = [resp.status_code for resp in responses]
    assert runs == 10
    assert statuses.count(302) == runs
    assert statuses.count(429) == 20 - runs

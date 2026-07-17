"""
Integration tests for authentication routes.
"""

import importlib.util
import logging
import time

import bcrypt
import httpx
import pytest
import respx
from joserfc import jwk
from joserfc import jwt as joserfc_jwt

import app.routes.auth as auth_module
import app.routes.auth_oidc as auth_oidc_module
from app import auth as _app_auth
from app.models.settings import GlobalSettings
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


def _build_id_token(email: str, nonce: str) -> str:
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
    assert resp.json() == {"authenticated": False, "user": None}


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


async def test_logout_clears_session_cookie(db_session, test_app):
    password = "correctpassword123"
    db_session.add(_make_user("logoutuser", password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post("/api/auth/login", json={"username": "logoutuser", "password": password})
    assert login_resp.status_code == 200

    logout_resp = await test_app.post("/api/auth/logout")
    assert logout_resp.status_code == 204
    assert logout_resp.content == b""
    assert "Max-Age=0" in logout_resp.headers.get("set-cookie", "")


async def test_change_password_returns_empty_204(db_session, test_app):
    old_password = "oldpassword123"
    new_password = "newpassword123"
    db_session.add(_make_user("changepwuser", old_password, UserRole.admin))
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "changepwuser", "password": old_password},
    )
    assert login_resp.status_code == 200

    change_resp = await test_app.post(
        "/api/auth/change-password",
        json={"current_password": old_password, "new_password": new_password},
    )

    assert change_resp.status_code == 204
    assert change_resp.content == b""
    relogin_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "changepwuser", "password": new_password},
    )
    assert relogin_resp.status_code == 200


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


async def test_successful_login_clears_ip_counter(db_session, test_app):
    """A successful login resets the IP counter so a user's own earlier typos do
    not lock them (or their NAT neighbours) out afterwards."""
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

import bcrypt
import pytest
from sqlalchemy import select

from app.models.user import User, UserRole

SESSION_PASSWORD = "sessionpassword123"


async def test_api_token_blocked_while_owner_must_change_password(test_app, db_session, auth_headers):
    created = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "sync", "scopes": ["licenses:read"]},
    )
    assert created.status_code == 201, created.text
    token = created.json()["token"]

    owner = await db_session.scalar(select(User).where(User.username == "testadmin"))
    owner.must_change_password = True
    await db_session.commit()

    response = await test_app.get("/api/licenses", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert "Password change required" in response.json()["detail"]


async def _login_with_cookie(test_app, db_session) -> str:
    db_session.add(User(
        username="cookiewriter",
        email="cookiewriter@test.local",
        hashed_password=bcrypt.hashpw(SESSION_PASSWORD.encode(), bcrypt.gensalt()).decode(),
        role=UserRole.editor,
        is_active=True,
        must_change_password=False,
    ))
    await db_session.commit()
    login = await test_app.post("/api/auth/login", json={"username": "cookiewriter", "password": SESSION_PASSWORD})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


async def test_cookie_write_without_request_header_is_rejected(test_app, db_session):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.put(
        "/api/settings",
        json={"theme": "dark"},
        headers={"X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 403
    assert "request header" in response.json()["detail"].lower()


async def test_cookie_write_with_request_header_is_allowed(test_app, db_session):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.put("/api/settings", json={"theme": "dark"})
    assert response.status_code == 200, response.text


async def test_cookie_read_without_request_header_is_allowed(test_app, db_session):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.get("/api/settings", headers={"X-LicenseTrack-Request": ""})
    assert response.status_code == 200


@pytest.mark.parametrize("authorization", [None, "Basic x", "Bearer "])
@pytest.mark.parametrize("request_header", [None, "", "0"])
async def test_cookie_logout_requires_header_and_preserves_session(
    test_app, db_session, authorization, request_header
):
    await _login_with_cookie(test_app, db_session)
    test_app.headers.pop("X-LicenseTrack-Request", None)
    headers = {}
    if authorization is not None:
        headers["Authorization"] = authorization
    if request_header is not None:
        headers["X-LicenseTrack-Request"] = request_header

    response = await test_app.post("/api/auth/logout", headers=headers)

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing application request header"
    assert "set-cookie" not in response.headers
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is True


async def test_cookie_logout_with_header_revokes_session(test_app, db_session):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.post("/api/auth/logout")
    assert response.status_code == 204
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is False


async def test_bearer_logout_without_header_revokes_session(test_app, db_session):
    token = await _login_with_cookie(test_app, db_session)
    # Sign-out may receive both credentials; the explicit bearer takes precedence.
    response = await test_app.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}", "X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 204
    assert (await test_app.get("/api/auth/session")).json()["authenticated"] is False


async def test_anonymous_logout_without_header_is_idempotent(test_app):
    test_app.headers.pop("X-LicenseTrack-Request", None)
    assert (await test_app.post("/api/auth/logout")).status_code == 204


async def test_invalid_bearer_logout_is_idempotent(test_app):
    response = await test_app.post(
        "/api/auth/logout",
        headers={"Authorization": "Bearer malformed", "X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 204


async def test_bearer_write_does_not_need_request_header(test_app, auth_headers):
    response = await test_app.put(
        "/api/settings",
        json={"theme": "dark"},
        headers={**auth_headers, "X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("authorization", ["Basic x", "Bearer "])
async def test_cookie_write_with_non_bearer_authorization_still_needs_request_header(
    test_app, db_session, authorization
):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.put(
        "/api/settings",
        json={"theme": "dark"},
        headers={"Authorization": authorization, "X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 403
    assert "request header" in response.json()["detail"].lower()


@pytest.mark.parametrize("authorization", ["Basic x", "Bearer "])
async def test_cookie_write_with_non_bearer_authorization_and_request_header_is_allowed(
    test_app, db_session, authorization
):
    await _login_with_cookie(test_app, db_session)
    response = await test_app.put(
        "/api/settings",
        json={"theme": "dark"},
        headers={"Authorization": authorization},
    )
    assert response.status_code == 200, response.text

import bcrypt
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


async def _login_with_cookie(test_app, db_session) -> None:
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


async def test_bearer_write_does_not_need_request_header(test_app, auth_headers):
    response = await test_app.put(
        "/api/settings",
        json={"theme": "dark"},
        headers={**auth_headers, "X-LicenseTrack-Request": ""},
    )
    assert response.status_code == 200, response.text

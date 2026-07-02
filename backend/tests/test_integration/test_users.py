import bcrypt

from app.models.user import AuthProvider, User, UserRole


def _make_user(
    username: str,
    password: str,
    *,
    role: UserRole = UserRole.admin,
    auth_provider: AuthProvider = AuthProvider.local,
    is_break_glass_admin: bool = False,
) -> User:
    return User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode(),
        role=role,
        auth_provider=auth_provider,
        is_active=True,
        is_break_glass_admin=is_break_glass_admin,
        must_change_password=False,
    )


async def test_break_glass_admin_cannot_be_converted_to_oidc(db_session, test_app, auth_headers):
    user = _make_user("admin", "password123", is_break_glass_admin=True)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "admin",
            "email": "admin@example.com",
            "role": "admin",
            "is_active": True,
            "auth_provider": "oidc",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_last_local_admin_cannot_be_disabled(db_session, test_app):
    user = _make_user("soleadmin", "password123")
    db_session.add(user)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "soleadmin", "password": "password123"},
    )
    assert login_resp.status_code == 200
    auth_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "soleadmin",
            "email": "soleadmin@example.com",
            "role": "admin",
            "is_active": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_break_glass_admin_cannot_be_deleted(db_session, test_app, auth_headers):
    user = _make_user("breakglass", "password123", is_break_glass_admin=True)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.delete(f"/api/users/{user.id}", headers=auth_headers)
    assert resp.status_code == 400


async def test_last_local_admin_cannot_be_deleted(db_session, test_app):
    user = _make_user("soleadmin2", "password123")
    db_session.add(user)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "soleadmin2", "password": "password123"},
    )
    assert login_resp.status_code == 200
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    viewer = _make_user("viewer1", "password123", role=UserRole.viewer)
    db_session.add(viewer)
    await db_session.commit()

    resp = await test_app.delete(f"/api/users/{user.id}", headers=headers)
    assert resp.status_code == 400


async def test_oidc_user_reset_password_rejected(db_session, test_app, auth_headers):
    user = _make_user("oidcuser", "password123", auth_provider=AuthProvider.oidc)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}/reset-password",
        json={"new_password": "newpassword123"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_create_user_persists_viewer_download_permission(test_app, auth_headers):
    resp = await test_app.post(
        "/api/users",
        json={
            "username": "viewer_read_only",
            "email": "viewer_read_only@example.com",
            "password": "password123456",
            "role": "viewer",
            "allow_downloads": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["role"] == "viewer"
    assert body["allow_downloads"] is False


async def test_update_user_persists_viewer_download_permission(db_session, test_app, auth_headers):
    user = _make_user("viewer_toggle", "password123456", role=UserRole.viewer)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "viewer_toggle",
            "email": "viewer_toggle@example.com",
            "role": "viewer",
            "is_active": True,
            "allow_downloads": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["allow_downloads"] is False


async def test_legacy_role_update_changes_role_and_audits(db_session, test_app, auth_headers):
    user = _make_user("legacy_role_user", "password123456", role=UserRole.viewer)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}/role",
        json={"role": "editor"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"


async def test_legacy_role_update_preserves_last_local_admin(db_session, test_app):
    admin = _make_user("legacy_sole_admin", "password123456", role=UserRole.admin)
    db_session.add(admin)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "legacy_sole_admin", "password": "password123456"},
    )
    assert login_resp.status_code == 200
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = await test_app.put(
        f"/api/users/{admin.id}/role",
        json={"role": "viewer"},
        headers=headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "At least one active local admin must always remain available"

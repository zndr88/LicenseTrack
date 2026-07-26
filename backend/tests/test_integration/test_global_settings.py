from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app import auth
import app.routes.global_settings as global_settings_routes
from app.models.settings import GlobalSettings
from app.models.user import User, UserRole
from app.schemas.settings import _SMTP_PASSWORD_MASK
from app.services import settings_service
from app.services.crypto_service import decrypt_secret


SECRET_MASK = _SMTP_PASSWORD_MASK


@pytest.fixture(autouse=True)
def clear_global_settings_cache():
    settings_service.invalidate_global_settings_cache()
    yield
    settings_service.invalidate_global_settings_cache()


async def _create_headers(db_session, username: str, role: UserRole) -> dict[str, str]:
    user = User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=auth.hash_password("testpassword123"),
        role=role,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return {"Authorization": f"Bearer {auth.create_access_token(user.id, user.role.value)}"}


async def _upsert_global_settings(db_session, **values) -> GlobalSettings:
    result = await db_session.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = GlobalSettings(id=1)
        db_session.add(settings)
        await db_session.flush()
    for field, value in values.items():
        setattr(settings, field, value)
    await db_session.commit()
    await db_session.refresh(settings)
    settings_service.invalidate_global_settings_cache()
    return settings


async def test_public_global_settings_returns_authenticated_public_subset(
    db_session,
    test_app,
    monkeypatch,
):
    headers = await _create_headers(db_session, "settings_viewer", UserRole.viewer)
    await _upsert_global_settings(
        db_session,
        mandatory_fields={"invoice": True, "eula": False},
        notification_days=45,
        oidc_enabled=True,
    )
    get_availability = AsyncMock(return_value=True)
    monkeypatch.setattr(global_settings_routes, "get_oidc_availability", get_availability)

    response = await test_app.get("/api/settings/global/public", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "mandatory_fields": {"invoice": True, "eula": False},
        "notification_days": 45,
        "notice_notification_days": 30,
        "oidc_enabled": True,
        "oidc_available": True,
    }
    get_availability.assert_awaited_once()


async def test_admin_global_settings_get_masks_secrets(db_session, test_app, auth_headers):
    await _upsert_global_settings(
        db_session,
        smtp_password="stored-smtp-secret",
        oidc_client_secret="stored-oidc-secret",
    )

    response = await test_app.get("/api/settings/global", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["smtp_password"] == SECRET_MASK
    assert body["oidc_client_secret"] == SECRET_MASK
    assert "stored-smtp-secret" not in response.text
    assert "stored-oidc-secret" not in response.text


async def test_put_global_settings_encrypts_and_masks_secrets(db_session, test_app, auth_headers):
    response = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={
            "smtp_password": "smtp-plain-secret",
            "oidc_client_secret": "oidc-plain-secret",
            "oidc_enabled": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["smtp_password"] == SECRET_MASK
    assert body["oidc_client_secret"] == SECRET_MASK

    settings = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert settings is not None
    assert settings.smtp_password != "smtp-plain-secret"
    assert settings.oidc_client_secret != "oidc-plain-secret"
    assert decrypt_secret(settings.smtp_password) == "smtp-plain-secret"
    assert decrypt_secret(settings.oidc_client_secret) == "oidc-plain-secret"


async def test_put_global_settings_preserves_secrets_when_mask_is_submitted(
    db_session,
    test_app,
    auth_headers,
):
    first = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={
            "smtp_password": "first-smtp-secret",
            "oidc_client_secret": "first-oidc-secret",
        },
    )
    assert first.status_code == 200
    settings = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert settings is not None
    original_smtp_ciphertext = settings.smtp_password
    original_oidc_ciphertext = settings.oidc_client_secret

    second = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={
            "notification_days": 90,
            "smtp_password": SECRET_MASK,
            "oidc_client_secret": SECRET_MASK,
        },
    )

    assert second.status_code == 200
    await db_session.refresh(settings)
    assert settings.notification_days == 90
    assert settings.smtp_password == original_smtp_ciphertext
    assert settings.oidc_client_secret == original_oidc_ciphertext


async def test_put_global_settings_invalidates_cached_global_settings(
    db_session,
    test_app,
    auth_headers,
    monkeypatch,
):
    await _upsert_global_settings(db_session, notification_days=15)
    cached = await settings_service.get_global_settings(db_session)
    assert cached is not None
    invalidations = 0
    real_invalidate = settings_service.invalidate_global_settings_cache

    def spy_invalidate() -> None:
        nonlocal invalidations
        invalidations += 1
        real_invalidate()

    monkeypatch.setattr(global_settings_routes, "invalidate_global_settings_cache", spy_invalidate)

    update_response = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={"notification_days": 75},
    )
    public_response = await test_app.get("/api/settings/global/public", headers=auth_headers)

    assert update_response.status_code == 200
    assert invalidations == 1
    assert public_response.status_code == 200
    assert public_response.json()["notification_days"] == 75


async def test_put_global_settings_persists_frontend_section_payloads(test_app, auth_headers):
    notifications = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={
            "notification_days": 45,
            "manager_email": "manager@example.com",
            "notification_send_hour": 8,
            "allowed_email_domains": "",
        },
    )
    security = await test_app.put(
        "/api/settings/global",
        headers=auth_headers,
        json={"session_timeout": 120},
    )
    fetched = await test_app.get("/api/settings/global", headers=auth_headers)

    assert notifications.status_code == 200, notifications.text
    assert security.status_code == 200, security.text
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    assert body["notification_days"] == 45
    assert body["manager_email"] == "manager@example.com"
    assert body["notification_send_hour"] == 8
    assert body["allowed_email_domains"] == ""
    assert body["session_timeout"] == 120


async def test_global_settings_admin_routes_reject_non_admins(db_session, test_app):
    viewer_headers = await _create_headers(db_session, "settings_viewer_denied", UserRole.viewer)
    editor_headers = await _create_headers(db_session, "settings_editor_denied", UserRole.editor)

    for headers in (viewer_headers, editor_headers):
        assert (await test_app.get("/api/settings/global", headers=headers)).status_code == 403
        assert (
            await test_app.put(
                "/api/settings/global",
                headers=headers,
                json={"notification_days": 60},
            )
        ).status_code == 403
        assert (
            await test_app.post("/api/settings/global/trigger-notifications", headers=headers)
        ).status_code == 403
        assert (
            await test_app.post("/api/settings/global/test-email", headers=headers)
        ).status_code == 403


async def test_trigger_notifications_requires_smtp_host(db_session, test_app, auth_headers):
    await _upsert_global_settings(db_session, smtp_host="")

    response = await test_app.post("/api/settings/global/trigger-notifications", headers=auth_headers)

    assert response.status_code == 422
    assert response.json()["detail"] == "SMTP is not configured"


async def test_trigger_notifications_returns_sender_summary(
    db_session,
    test_app,
    auth_headers,
    monkeypatch,
):
    await _upsert_global_settings(db_session, smtp_host="smtp.test.local")
    run_daily_notifications = AsyncMock(return_value={"sent": 2, "skipped": 1})
    monkeypatch.setattr(
        "app.services.notification_sender.run_daily_notifications",
        run_daily_notifications,
    )

    response = await test_app.post("/api/settings/global/trigger-notifications", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {"sent": 2, "skipped": 1}
    run_daily_notifications.assert_awaited_once_with(db_session)


async def test_test_email_success_uses_current_settings(
    db_session,
    test_app,
    auth_headers,
    monkeypatch,
):
    await _upsert_global_settings(
        db_session,
        smtp_host="smtp.test.local",
        manager_email="manager@example.com",
        allowed_email_domains="example.com",
    )
    send_test_email = AsyncMock(return_value=None)
    monkeypatch.setattr("app.services.email_service.send_test_email", send_test_email)

    response = await test_app.post("/api/settings/global/test-email", headers=auth_headers)

    assert response.status_code == 204
    assert response.content == b""
    settings_arg, to_arg = send_test_email.await_args.args
    assert settings_arg.smtp_host == "smtp.test.local"
    assert to_arg == "manager@example.com"


async def test_test_email_validates_required_configuration(db_session, test_app, auth_headers):
    await _upsert_global_settings(db_session, smtp_host="")

    no_host = await test_app.post("/api/settings/global/test-email", headers=auth_headers)
    assert no_host.status_code == 422
    assert no_host.json()["detail"] == "SMTP host is not configured"

    await _upsert_global_settings(db_session, smtp_host="smtp.test.local", manager_email="")
    no_manager = await test_app.post("/api/settings/global/test-email", headers=auth_headers)
    assert no_manager.status_code == 422
    assert "Manager email is not configured" in no_manager.json()["detail"]

    await _upsert_global_settings(
        db_session,
        smtp_host="smtp.test.local",
        manager_email="manager@blocked.test",
        allowed_email_domains="example.com",
    )
    blocked_domain = await test_app.post("/api/settings/global/test-email", headers=auth_headers)
    assert blocked_domain.status_code == 422
    assert "allowed domains whitelist" in blocked_domain.json()["detail"]


async def test_test_email_reports_send_failures(
    db_session,
    test_app,
    auth_headers,
    monkeypatch,
):
    await _upsert_global_settings(
        db_session,
        smtp_host="smtp.test.local",
        manager_email="manager@example.com",
    )
    send_test_email = AsyncMock(side_effect=RuntimeError("smtp refused"))
    monkeypatch.setattr("app.services.email_service.send_test_email", send_test_email)

    response = await test_app.post("/api/settings/global/test-email", headers=auth_headers)

    assert response.status_code == 502
    assert response.json()["detail"] == "Failed to send test email: smtp refused"

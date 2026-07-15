from sqlalchemy import select

from app.models.api_token import ApiToken
from app.models.audit_log import AuditLog
from app.services.api_token_service import hash_api_token, hash_legacy_api_token


def _minimal_license_payload() -> dict:
    return {
        "publisherName": "Token Corp",
        "softwareDescription": "Token Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "5",
        "currency": "EUR",
    }


async def test_admin_can_create_list_and_revoke_api_token(test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "CMDB sync", "scopes": ["licenses:read", "licenses:write"]},
    )

    assert create_resp.status_code == 201, create_resp.text
    body = create_resp.json()
    assert body["token"].startswith("lt_")
    assert body["token_prefix"] == body["token"][:12]
    assert body["scopes"] == ["licenses:read", "licenses:write"]

    stored = await db_session.scalar(select(ApiToken).where(ApiToken.id == body["id"]))
    assert stored is not None
    assert stored.token_hash == hash_api_token(body["token"])
    assert stored.token_hash != body["token"]

    list_resp = await test_app.get("/api/api-tokens", headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["token_prefix"] == body["token_prefix"]
    assert "token" not in list_resp.json()[0]

    revoke_resp = await test_app.delete(f"/api/api-tokens/{body['id']}", headers=auth_headers)
    assert revoke_resp.status_code == 204
    await db_session.refresh(stored)
    assert stored.revoked_at is not None

    audit_result = await db_session.execute(
        select(AuditLog.action).where(AuditLog.action.in_(["api_token.created", "api_token.revoked"]))
    )
    assert sorted(audit_result.scalars().all()) == ["api_token.created", "api_token.revoked"]


async def test_api_token_can_use_matching_license_scopes(test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "License writer", "scopes": ["licenses:read", "licenses:write"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    token = create_resp.json()["token"]
    token_headers = {"Authorization": f"Bearer {token}"}

    create_license = await test_app.post(
        "/api/licenses",
        headers=token_headers,
        json=_minimal_license_payload(),
    )
    assert create_license.status_code == 201, create_license.text

    list_licenses = await test_app.get("/api/licenses", headers=token_headers)
    assert list_licenses.status_code == 200
    assert list_licenses.json()[0]["publisherName"] == "Token Corp"

    stored = await db_session.scalar(select(ApiToken).where(ApiToken.id == create_resp.json()["id"]))
    await db_session.refresh(stored)
    assert stored.last_used_at is not None


async def test_legacy_api_token_hash_is_accepted_and_migrated(test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Legacy token", "scopes": ["licenses:read"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    token = create_resp.json()["token"]

    stored = await db_session.scalar(select(ApiToken).where(ApiToken.id == create_resp.json()["id"]))
    stored.token_hash = hash_legacy_api_token(token)
    await db_session.commit()

    resp = await test_app.get("/api/licenses", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    await db_session.refresh(stored)
    assert stored.token_hash == hash_api_token(token)


async def test_api_token_data_changes_are_attributed_in_audit_detail(test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "License writer audit", "scopes": ["licenses:read", "licenses:write"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    token = create_resp.json()["token"]
    token_headers = {"Authorization": f"Bearer {token}"}

    license_resp = await test_app.post(
        "/api/licenses",
        headers=token_headers,
        json=_minimal_license_payload(),
    )

    assert license_resp.status_code == 201, license_resp.text
    audit_event = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "license.created").order_by(AuditLog.id.desc())
    )
    assert audit_event is not None
    assert audit_event.actor_email == "testadmin@test.local"
    assert "via API token: License writer audit" in audit_event.detail


async def test_api_token_license_reads_include_custom_fields(test_app, auth_headers):
    field_resp = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "CMDB Owner", "fieldType": "text"},
    )
    assert field_resp.status_code == 201, field_resp.text

    license_resp = await test_app.post(
        "/api/licenses",
        headers=auth_headers,
        json=_minimal_license_payload(),
    )
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    value_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        headers=auth_headers,
        json={"values": [{"customFieldDefId": field_resp.json()["id"], "valueText": "asset-team@example.com"}]},
    )
    assert value_resp.status_code == 200, value_resp.text

    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "CMDB reader", "scopes": ["licenses:read"]},
    )
    assert token_resp.status_code == 201, token_resp.text

    list_resp = await test_app.get(
        "/api/licenses",
        headers={"Authorization": f"Bearer {token_resp.json()['token']}"},
    )

    assert list_resp.status_code == 200, list_resp.text
    listed_license = next(item for item in list_resp.json() if item["id"] == license_id)
    assert listed_license["customFields"][0]["valueText"] == "asset-team@example.com"
    assert listed_license["customFields"][0]["definition"]["fieldKey"] == "cf_cmdb_owner"


async def test_api_token_missing_scope_is_rejected(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Read only", "scopes": ["licenses:read"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    token_headers = {"Authorization": f"Bearer {create_resp.json()['token']}"}

    resp = await test_app.post(
        "/api/licenses",
        headers=token_headers,
        json=_minimal_license_payload(),
    )
    assert resp.status_code == 403
    assert "licenses:write" in resp.json()["detail"]


async def test_api_token_cannot_use_unsupported_admin_routes(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "License reader", "scopes": ["licenses:read"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    token_headers = {"Authorization": f"Bearer {create_resp.json()['token']}"}

    resp = await test_app.get("/api/settings/global", headers=token_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "API tokens are not supported for this route"


async def test_revoked_api_token_is_rejected(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Temporary", "scopes": ["licenses:read"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    body = create_resp.json()

    revoke_resp = await test_app.delete(f"/api/api-tokens/{body['id']}", headers=auth_headers)
    assert revoke_resp.status_code == 204

    resp = await test_app.get("/api/licenses", headers={"Authorization": f"Bearer {body['token']}"})
    assert resp.status_code == 401

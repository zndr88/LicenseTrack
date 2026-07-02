from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.extension import ExtensionCapability


def _payload(status: str = "available") -> dict:
    return {
        "name": "AI document processor",
        "capabilityType": "document.processing",
        "status": status,
        "version": "0.1.0",
        "description": "Parses selected uploaded documents.",
        "healthUrl": "http://processor.local/health",
        "details": {"provider": "anthropic"},
    }


async def test_admin_can_register_list_and_delete_extension_capability(test_app, db_session, auth_headers):
    upsert_resp = await test_app.put(
        "/api/extensions/capabilities/licensetrack-ai",
        headers=auth_headers,
        json=_payload(),
    )
    assert upsert_resp.status_code == 200, upsert_resp.text
    created = upsert_resp.json()
    assert created["key"] == "licensetrack-ai"
    assert created["capabilityType"] == "document.processing"
    assert created["status"] == "available"
    assert created["details"] == {"provider": "anthropic"}

    list_resp = await test_app.get("/api/extensions/capabilities", headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["key"] == "licensetrack-ai"

    delete_resp = await test_app.delete("/api/extensions/capabilities/licensetrack-ai", headers=auth_headers)
    assert delete_resp.status_code == 204
    stored = await db_session.scalar(select(ExtensionCapability).where(ExtensionCapability.key == "licensetrack-ai"))
    assert stored is None

    audit_result = await db_session.execute(
        select(AuditLog.action).where(
            AuditLog.action.in_([
                "extension_capability.created",
                "extension_capability.deleted",
            ])
        )
    )
    assert sorted(audit_result.scalars().all()) == [
        "extension_capability.created",
        "extension_capability.deleted",
    ]


async def test_api_token_can_register_extension_capability_with_extension_scope(test_app, auth_headers):
    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Extension registrar", "scopes": ["extensions:write"]},
    )
    assert token_resp.status_code == 201, token_resp.text

    upsert_resp = await test_app.put(
        "/api/extensions/capabilities/licensetrack-ai",
        headers={"Authorization": f"Bearer {token_resp.json()['token']}"},
        json=_payload("misconfigured") | {"lastError": "Missing provider API key"},
    )

    assert upsert_resp.status_code == 200, upsert_resp.text
    assert upsert_resp.json()["status"] == "misconfigured"
    assert upsert_resp.json()["lastError"] == "Missing provider API key"


async def test_api_token_missing_extension_scope_is_rejected(test_app, auth_headers):
    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "License reader", "scopes": ["licenses:read"]},
    )
    assert token_resp.status_code == 201, token_resp.text

    upsert_resp = await test_app.put(
        "/api/extensions/capabilities/licensetrack-ai",
        headers={"Authorization": f"Bearer {token_resp.json()['token']}"},
        json=_payload(),
    )

    assert upsert_resp.status_code == 403
    assert "extensions:write" in upsert_resp.json()["detail"]

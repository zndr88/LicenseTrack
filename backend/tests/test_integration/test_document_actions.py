import pytest
from sqlalchemy import select

import app.services.storage as _storage_module
from app.models.audit_log import AuditLog
from app.models.webhook import WebhookDelivery


@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "documents").mkdir()
    return tmp_path


def _minimal_license_payload() -> dict:
    return {
        "publisherName": "Document Action Corp",
        "softwareDescription": "Action Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "5",
        "currency": "EUR",
    }


async def _register_document_processor(test_app, auth_headers, *, status: str = "available") -> None:
    response = await test_app.put(
        "/api/extensions/capabilities/licensetrack-ai",
        headers=auth_headers,
        json={
            "name": "AI document processor",
            "capabilityType": "document.processing",
            "status": status,
        },
    )
    assert response.status_code == 200, response.text


async def test_document_actions_are_hidden_without_active_subscriber(test_app, auth_headers):
    response = await test_app.get("/api/document-actions", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == []


async def test_document_actions_are_listed_with_active_subscriber(test_app, auth_headers):
    webhook_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={
            "name": "Document processor",
            "url": "https://example.com/licensetrack/documents",
            "events": ["document_action.requested"],
        },
    )
    assert webhook_resp.status_code == 201, webhook_resp.text
    await _register_document_processor(test_app, auth_headers)

    response = await test_app.get("/api/document-actions", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == [
        {
            "key": "request_processing",
            "label": "Request processing",
            "description": "Emit a document action event for an external processor.",
        }
    ]


async def test_document_actions_are_hidden_without_available_processor_capability(test_app, auth_headers):
    webhook_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={
            "name": "Document processor",
            "url": "https://example.com/licensetrack/documents",
            "events": ["document_action.requested"],
        },
    )
    assert webhook_resp.status_code == 201, webhook_resp.text
    await _register_document_processor(test_app, auth_headers, status="misconfigured")

    response = await test_app.get("/api/document-actions", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == []


async def test_document_action_invocation_requires_active_subscriber(test_app, auth_headers):
    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    invoke_resp = await test_app.post(
        "/api/document-actions/request_processing/invoke",
        headers=auth_headers,
        json={"documentType": "license_document", "documentId": document_id},
    )

    assert invoke_resp.status_code == 409
    assert invoke_resp.json()["detail"] == "No active document processor webhook is configured"


async def test_document_action_invocation_requires_available_processor_capability(test_app, auth_headers):
    webhook_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={
            "name": "Document processor",
            "url": "https://example.com/licensetrack/documents",
            "events": ["document_action.requested"],
        },
    )
    assert webhook_resp.status_code == 201, webhook_resp.text

    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    invoke_resp = await test_app.post(
        "/api/document-actions/request_processing/invoke",
        headers=auth_headers,
        json={"documentType": "license_document", "documentId": document_id},
    )

    assert invoke_resp.status_code == 409
    assert invoke_resp.json()["detail"] == "No available document processor extension is registered"


async def test_document_action_invocation_rejects_misconfigured_processor_capability(test_app, auth_headers):
    webhook_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={
            "name": "Document processor",
            "url": "https://example.com/licensetrack/documents",
            "events": ["document_action.requested"],
        },
    )
    assert webhook_resp.status_code == 201, webhook_resp.text
    await _register_document_processor(test_app, auth_headers, status="misconfigured")

    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    invoke_resp = await test_app.post(
        "/api/document-actions/request_processing/invoke",
        headers=auth_headers,
        json={"documentType": "license_document", "documentId": document_id},
    )

    assert invoke_resp.status_code == 409
    assert invoke_resp.json()["detail"] == "No available document processor extension is registered"


async def test_document_action_invocation_audits_and_enqueues_webhook(
    test_app,
    db_session,
    auth_headers,
):
    webhook_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={
            "name": "Document processor",
            "url": "https://example.com/licensetrack/documents",
            "events": ["document_action.requested"],
        },
    )
    assert webhook_resp.status_code == 201, webhook_resp.text
    await _register_document_processor(test_app, auth_headers)

    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    invoke_resp = await test_app.post(
        "/api/document-actions/request_processing/invoke",
        headers=auth_headers,
        json={"documentType": "license_document", "documentId": document_id},
    )
    assert invoke_resp.status_code == 200, invoke_resp.text
    assert invoke_resp.json() == {
        "actionKey": "request_processing",
        "documentType": "license_document",
        "documentId": document_id,
        "status": "accepted",
    }

    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "document_action.requested")
    )
    assert audit is not None
    assert audit.target_type == "license_document"
    assert audit.target_id == str(document_id)
    assert audit.target_label == "entitlement.pdf"
    assert "action=request_processing" in audit.detail
    assert f"licenseId={license_id}" in audit.detail

    delivery = await db_session.scalar(
        select(WebhookDelivery).where(WebhookDelivery.event_type == "document_action.requested")
    )
    assert delivery is not None
    assert delivery.status == "pending"
    assert delivery.payload["event"] == "document_action.requested"
    assert delivery.payload["targetId"] == str(document_id)
    assert "filename=entitlement.pdf" in delivery.payload["detail"]

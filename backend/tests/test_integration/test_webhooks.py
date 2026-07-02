from sqlalchemy import select

from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services import webhook_service


def _minimal_license_payload() -> dict:
    return {
        "publisherName": "Webhook Corp",
        "softwareDescription": "Webhook Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "5",
        "currency": "EUR",
    }


async def test_admin_can_create_list_and_delete_webhook_endpoint(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={"name": "CMDB events", "url": "https://example.com/webhooks/licensetrack", "events": ["license.created"]},
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["signingSecret"].startswith("whsec_")
    assert created["events"] == ["license.created"]

    list_resp = await test_app.get("/api/webhooks", headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["name"] == "CMDB events"
    assert "signingSecret" not in list_resp.json()[0]

    delete_resp = await test_app.delete(f"/api/webhooks/{created['id']}", headers=auth_headers)
    assert delete_resp.status_code == 204


async def test_audit_events_enqueue_matching_webhook_deliveries(test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={"name": "License events", "url": "https://example.com/webhooks/licensetrack", "events": ["license.created"]},
    )
    assert create_resp.status_code == 201, create_resp.text

    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text

    delivery = await db_session.scalar(
        select(WebhookDelivery).where(WebhookDelivery.event_type == "license.created")
    )
    assert delivery is not None
    assert delivery.status == "pending"
    assert delivery.payload["event"] == "license.created"
    assert delivery.payload["targetLabel"] == "Webhook Suite"


async def test_webhook_delivery_retry_marks_success(monkeypatch, test_app, db_session, auth_headers):
    create_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={"name": "Retry events", "url": "https://example.com/webhooks/licensetrack", "events": ["license.created"]},
    )
    assert create_resp.status_code == 201, create_resp.text

    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text

    delivery = await db_session.scalar(
        select(WebhookDelivery).where(WebhookDelivery.event_type == "license.created")
    )
    assert delivery is not None

    def fake_post(_endpoint: WebhookEndpoint, _delivery: WebhookDelivery) -> tuple[int, str]:
        return 204, "ok"

    monkeypatch.setattr(webhook_service, "_post_webhook", fake_post)

    retry_resp = await test_app.post(f"/api/webhooks/deliveries/{delivery.id}/retry", headers=auth_headers)
    assert retry_resp.status_code == 200, retry_resp.text
    body = retry_resp.json()
    assert body["status"] == "succeeded"
    assert body["attempts"] == 1
    assert body["responseStatus"] == 204


async def test_webhook_endpoint_test_sends_synthetic_delivery(monkeypatch, test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/webhooks",
        headers=auth_headers,
        json={"name": "Test events", "url": "https://example.com/webhooks/licensetrack", "events": ["license.created"]},
    )
    assert create_resp.status_code == 201, create_resp.text

    def fake_post(_endpoint: WebhookEndpoint, delivery: WebhookDelivery) -> tuple[int, str]:
        assert delivery.event_type == "webhook.test"
        return 204, "ok"

    monkeypatch.setattr(webhook_service, "_post_webhook", fake_post)

    test_resp = await test_app.post(f"/api/webhooks/{create_resp.json()['id']}/test", headers=auth_headers)
    assert test_resp.status_code == 200, test_resp.text
    body = test_resp.json()
    assert body["eventType"] == "webhook.test"
    assert body["status"] == "succeeded"

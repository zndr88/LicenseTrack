"""The shared renewal-in-progress answer across alerts and write guards."""

from datetime import date, timedelta

from app.models.license import License


def _payload(**overrides) -> dict:
    payload = {
        "publisherName": "Acme",
        "softwareDescription": "Acme Suite",
        "licenseType": "perpetual",
        "licenseMetric": "per_user",
        "quantity": "1",
        "unitPrice": "100",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
        "startDate": "2026-01-01",
    }
    payload.update(overrides)
    return payload


async def _create(client, headers, **overrides) -> dict:
    response = await client.post("/api/licenses", json=_payload(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _included_parent(client, headers) -> dict:
    support_end = date.today() + timedelta(days=10)
    return await _create(
        client,
        headers,
        maintenanceCoverage="included",
        maintenanceStartDate=(support_end - timedelta(days=364)).isoformat(),
        maintenanceEndDate=support_end.isoformat(),
        maintenanceCost="250",
    )


async def test_support_alert_says_when_renewal_is_in_progress(test_app, auth_headers):
    parent = await _included_parent(test_app, auth_headers)
    started = await test_app.post(
        f"/api/licenses/{parent['id']}/support-renewal",
        headers=auth_headers,
    )
    assert started.status_code == 201, started.text

    notifications = await test_app.get("/api/notifications", headers=auth_headers)

    assert notifications.status_code == 200, notifications.text
    support_alert = next(
        row
        for row in notifications.json()
        if row["license_id"] == parent["id"] and row["type"] == "support_expiring"
    )
    assert support_alert["detail"].endswith("; renewal is in progress")


async def test_retirement_scheduled_parent_is_absent_and_cannot_start_support_renewal(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _included_parent(test_app, auth_headers)
    row = await db_session.get(License, parent["id"])
    row.retirement_scheduled = True
    await db_session.commit()

    workbench = await test_app.get("/api/renewals/workbench", headers=auth_headers)
    started = await test_app.post(
        f"/api/licenses/{parent['id']}/support-renewal",
        headers=auth_headers,
    )

    assert workbench.status_code == 200, workbench.text
    assert parent["id"] not in {
        item["licenseId"]
        for item in workbench.json()
        if item["rowKind"] == "support_renewal"
    }
    assert started.status_code == 409, started.text


async def test_retirement_is_blocked_for_license_and_support_renewals(test_app, auth_headers):
    subscription = await _create(
        test_app,
        auth_headers,
        licenseType="subscription",
        endDate=(date.today() + timedelta(days=10)).isoformat(),
    )
    renewal = await test_app.post(
        f"/api/licenses/{subscription['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert renewal.status_code == 200, renewal.text

    retire_subscription = await test_app.put(
        f"/api/licenses/{subscription['id']}",
        json={"isRetired": True},
        headers=auth_headers,
    )

    parent = await _included_parent(test_app, auth_headers)
    support_renewal = await test_app.post(
        f"/api/licenses/{parent['id']}/support-renewal",
        headers=auth_headers,
    )
    assert support_renewal.status_code == 201, support_renewal.text
    retire_parent = await test_app.put(
        f"/api/licenses/{parent['id']}",
        json={"isRetired": True},
        headers=auth_headers,
    )

    assert retire_subscription.status_code == 409, retire_subscription.text
    assert retire_subscription.json()["detail"] == "Cancel the renewal first, then retire this license"
    assert retire_parent.status_code == 409, retire_parent.text
    assert retire_parent.json()["detail"] == "Cancel the renewal first, then retire this license"

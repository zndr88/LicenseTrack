"""Support lifecycle: included-support history, support status, maintenance chains."""

from datetime import date, timedelta


def _payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme",
        "softwareDescription": "Acme Server",
        "licenseType": "perpetual",
        "licenseMetric": "per_user",
        "quantity": "1",
        "unitPrice": "10000",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
        "startDate": "2024-01-01",
    }
    base.update(overrides)
    return base


async def _create(client, headers, **overrides) -> dict:
    resp = await client.post("/api/licenses", json=_payload(**overrides), headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _included_parent(client, headers, **overrides) -> dict:
    return await _create(
        client,
        headers,
        maintenanceCoverage="included",
        maintenanceStartDate="2024-01-01",
        maintenanceEndDate="2024-12-31",
        maintenanceCost="2000",
        **overrides,
    )


async def test_switching_to_separately_tracked_keeps_the_included_period(test_app, auth_headers):
    parent = await _included_parent(test_app, auth_headers)
    assert parent["maintenanceEndDate"] == "2024-12-31"

    switched = await test_app.patch(
        f"/api/licenses/{parent['id']}/field",
        json={"field": "maintenanceCoverage", "value": "separately_tracked"},
        headers=auth_headers,
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["maintenanceEndDate"] is None

    await _create(
        test_app,
        auth_headers,
        licenseType="maintenance",
        softwareDescription="Acme Server Maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
        unitPrice="2100",
    )

    history = await test_app.get(f"/api/licenses/{parent['id']}/coverage-history", headers=auth_headers)
    assert history.status_code == 200, history.text
    included = [row for row in history.json() if row["coverageType"] == "included"]
    assert [(row["startDate"], row["endDate"]) for row in included] == [("2024-01-01", "2024-12-31")]


async def _included_history(client, headers, parent_id) -> list[tuple[str, str]]:
    history = await client.get(f"/api/licenses/{parent_id}/coverage-history", headers=headers)
    assert history.status_code == 200, history.text
    return [(row["startDate"], row["endDate"]) for row in history.json() if row["coverageType"] == "included"]


async def test_full_edit_to_separately_tracked_keeps_the_included_period(test_app, auth_headers):
    parent = await _included_parent(test_app, auth_headers)

    updated = await test_app.put(
        f"/api/licenses/{parent['id']}",
        json={"maintenanceCoverage": "separately_tracked"},
        headers=auth_headers,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["maintenanceStartDate"] is None
    assert await _included_history(test_app, auth_headers, parent["id"]) == [("2024-01-01", "2024-12-31")]


async def test_legacy_switched_parent_snapshots_its_leftover_period_on_first_maintenance(
    test_app, auth_headers, db_session,
):
    from app.models.license import License, MaintenanceCoverage

    parent = await _included_parent(test_app, auth_headers)
    # Simulate a record switched before 1.1.24: coverage changed, mirrors left in place.
    row = await db_session.get(License, parent["id"])
    row.maintenance_coverage = MaintenanceCoverage.separately_tracked
    await db_session.commit()

    await _create(
        test_app, auth_headers, licenseType="maintenance", softwareDescription="Maint",
        parentLicenseId=parent["id"], startDate="2025-01-01", endDate="2025-12-31", unitPrice="2100",
    )

    assert await _included_history(test_app, auth_headers, parent["id"]) == [("2024-01-01", "2024-12-31")]

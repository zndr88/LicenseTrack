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


async def test_license_response_carries_support_status(test_app, auth_headers):
    soon = (date.today() + timedelta(days=10)).isoformat()
    parent = await _create(
        test_app, auth_headers, maintenanceCoverage="included",
        maintenanceStartDate="2024-01-01", maintenanceEndDate=soon, maintenanceCost="100",
    )
    subscription = await _create(test_app, auth_headers, licenseType="subscription", endDate=soon)

    assert parent["supportStatus"] == "expiring"
    assert parent["supportDaysRemaining"] == 10
    assert subscription["supportStatus"] is None


async def test_support_renewal_runs_through_procurement_to_an_active_support_record(test_app, auth_headers):
    import json

    support_end = date.today() + timedelta(days=20)
    parent = await _create(
        test_app, auth_headers, maintenanceCoverage="included", supplier="Reseller",
        maintenanceStartDate=(support_end - timedelta(days=364)).isoformat(),
        maintenanceEndDate=support_end.isoformat(), maintenanceCost="2000",
    )

    rows = (await test_app.get("/api/renewals/workbench", headers=auth_headers)).json()
    row = next(row for row in rows if row["licenseId"] == parent["id"])
    assert row["rowKind"] == "support_renewal"
    assert row["renewalStatus"] == "due_soon"
    assert row["daysUntilExpiry"] == 20

    started = await test_app.post(f"/api/licenses/{parent['id']}/support-renewal", headers=auth_headers)
    assert started.status_code == 201, started.text
    line = started.json()["sourcingItem"]
    assert line["licenseType"] == "maintenance"
    assert line["maintenanceParentLicenseId"] == parent["id"]
    assert line["startDate"] == (support_end + timedelta(days=1)).isoformat()
    again = await test_app.post(f"/api/licenses/{parent['id']}/support-renewal", headers=auth_headers)
    assert again.status_code == 409

    rows = (await test_app.get("/api/renewals/workbench", headers=auth_headers)).json()
    assert next(row for row in rows if row["licenseId"] == parent["id"])["renewalStatus"] == "in_sourcing"

    po = await test_app.post(
        f"/api/sourcing/{line['id']}/convert", json={"poNumber": "PO-SUPPORT", "supplier": "Reseller"}, headers=auth_headers,
    )
    assert po.status_code == 200, po.text
    converted = await test_app.post(
        f"/api/pending-orders/{po.json()['id']}/convert",
        data={"data": json.dumps({
            "publisherName": "Acme",
            "softwareDescription": "Acme Server Maintenance",
            "licenseType": "maintenance",
            "licenseMetric": "per_user",
            "quantity": "1",
            "unitPrice": "2100",
            "currency": "EUR",
            "startDate": line["startDate"],
            "endDate": line["endDate"],
            "purchaseDate": date.today().isoformat(),
        })},
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    maintenance = next(row for row in converted.json() if row["licenseType"] == "maintenance")

    refreshed = (await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)).json()
    assert refreshed["activeMaintenanceId"] == maintenance["id"]
    assert refreshed["maintenanceCoverage"] == "separately_tracked"
    assert await _included_history(test_app, auth_headers, parent["id"]) == [
        ((support_end - timedelta(days=364)).isoformat(), support_end.isoformat()),
    ]
    rows = (await test_app.get("/api/renewals/workbench", headers=auth_headers)).json()
    assert parent["id"] not in {row["licenseId"] for row in rows if row["rowKind"] == "support_renewal"}


async def test_support_renewal_rejects_licenses_without_included_support(test_app, auth_headers):
    subscription = await _create(test_app, auth_headers, licenseType="subscription", endDate="2027-01-01")

    resp = await test_app.post(f"/api/licenses/{subscription['id']}/support-renewal", headers=auth_headers)

    assert resp.status_code == 400


async def test_five_term_maintenance_chain_hands_over_year_by_year(test_app, auth_headers, db_session):
    from app.services.maintenance_service import hand_over_due_maintenance

    today = date.today()
    parent = await _create(test_app, auth_headers, softwareDescription="Chain Server", maintenanceCoverage="separately_tracked")
    terms = []
    for year in range(5):
        start = today.replace(day=1) + timedelta(days=366 * year)
        terms.append((start, start + timedelta(days=364)))

    def line(index: int, predecessor_id: int | None = None) -> dict:
        start, end = terms[index]
        return {
            "publisherName": "Acme",
            "softwareDescription": f"Chain Server Maintenance Y{index + 1}",
            "licenseType": "maintenance",
            "licenseMetric": "per_user",
            "quantity": "1",
            "estimatedUnitPrice": "100",
            "currency": "EUR",
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            **({"maintenanceParentLicenseId": parent["id"]} if predecessor_id is None else {}),
            **({"successorOfItemIds": [predecessor_id]} if predecessor_id else {}),
        }

    request = await test_app.post(
        "/api/sourcing/requests", json={"supplier": "Acme Direct", "items": [line(0)]}, headers=auth_headers,
    )
    assert request.status_code == 201, request.text
    items = [request.json()["items"][0]]
    for index in range(1, 5):
        added = await test_app.post(
            f"/api/sourcing/requests/{request.json()['id']}/items", json=line(index, items[-1]["id"]), headers=auth_headers,
        )
        assert added.status_code == 201, added.text
        items.append(added.json()["items"][-1])

    order = await test_app.post(
        f"/api/sourcing/requests/{request.json()['id']}/convert",
        json={"poNumber": "PO-CHAIN", "supplier": "Acme Direct"},
        headers=auth_headers,
    )
    assert order.status_code == 200, order.text
    # Only the chain head names its parent; later terms inherit it at conversion.
    converted = await test_app.post(
        f"/api/pending-orders/{order.json()['id']}/convert-all",
        json=[
            {
                "sourcingItemId": item["id"],
                "publisherName": "Acme",
                "softwareDescription": item["softwareDescription"],
                "licenseType": "maintenance",
                "licenseMetric": "per_user",
                "quantity": "1",
                "unitPrice": "100",
                "currency": "EUR",
                "startDate": item["startDate"],
                "endDate": item["endDate"],
                "purchaseDate": today.isoformat(),
                **({"parentLicenseId": parent["id"]} if index == 0 else {}),
            }
            for index, item in enumerate(items)
        ],
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    records = sorted(
        (row for row in converted.json() if row["licenseType"] == "maintenance"),
        key=lambda row: row["startDate"],
    )
    assert len(records) == 5
    assert all(row["parentLicenseId"] == parent["id"] for row in records)

    refreshed = (await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)).json()
    assert refreshed["activeMaintenanceId"] == records[0]["id"]
    assert set(refreshed["linkedMaintenanceIds"]) == {row["id"] for row in records}

    for year in range(1, 5):
        assert await hand_over_due_maintenance(db_session, today=terms[year][0]) == 1
        assert await hand_over_due_maintenance(db_session, today=terms[year][0]) == 0
        db_session.expire_all()
        refreshed = (await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)).json()
        assert refreshed["activeMaintenanceId"] == records[year]["id"]

    history = (await test_app.get(f"/api/licenses/{parent['id']}/coverage-history", headers=auth_headers)).json()
    snapshotted = sorted(row["maintenanceLicenseId"] for row in history if row["sourceType"] == "maintenance_record")
    assert snapshotted == sorted(row["id"] for row in records[:4])
    assert [row["maintenanceLicenseId"] for row in history if row["sourceType"] == "current_maintenance_record"] == [records[4]["id"]]


async def test_maintenance_cannot_follow_a_subscription_term(test_app, auth_headers):
    request = await test_app.post(
        "/api/sourcing/requests",
        json={"supplier": "Acme Direct", "items": [{
            "publisherName": "Acme", "softwareDescription": "Suite", "licenseType": "subscription",
            "licenseMetric": "per_user", "quantity": "1", "currency": "EUR",
            "startDate": "2027-01-01", "endDate": "2027-12-31",
        }]},
        headers=auth_headers,
    )
    head = request.json()["items"][0]

    added = await test_app.post(
        f"/api/sourcing/requests/{request.json()['id']}/items",
        json={
            "publisherName": "Acme", "softwareDescription": "Suite Maintenance", "licenseType": "maintenance",
            "licenseMetric": "per_user", "quantity": "1", "currency": "EUR",
            "startDate": "2028-01-01", "endDate": "2028-12-31", "successorOfItemIds": [head["id"]],
        },
        headers=auth_headers,
    )

    assert added.status_code == 422
    assert "maintenance" in added.json()["detail"].lower()


async def test_included_support_can_be_edited_after_switching_coverage(test_app, auth_headers):
    freeware = await _create(test_app, auth_headers, licenseType="freeware", unitPrice="", softwareDescription="Community Tool")
    switched = await test_app.patch(
        f"/api/licenses/{freeware['id']}/field",
        json={"field": "maintenanceCoverage", "value": "included"},
        headers=auth_headers,
    )
    assert switched.status_code == 200, switched.text

    soon = (date.today() + timedelta(days=15)).isoformat()
    no_cost = await test_app.put(
        f"/api/licenses/{freeware['id']}/included-support",
        json={"maintenanceStartDate": "2026-01-01", "maintenanceEndDate": soon},
        headers=auth_headers,
    )
    assert no_cost.status_code == 200, no_cost.text
    assert no_cost.json()["maintenanceEndDate"] == soon
    assert no_cost.json()["maintenanceCost"] is None
    assert no_cost.json()["supportStatus"] == "expiring"

    per_unit = await test_app.put(
        f"/api/licenses/{freeware['id']}/included-support",
        json={
            "maintenanceStartDate": "2026-01-01",
            "maintenanceEndDate": soon,
            "maintenancePricingBasis": "per_unit",
            "maintenanceQuantity": "4",
            "maintenanceUnitPrice": "25",
        },
        headers=auth_headers,
    )
    assert per_unit.status_code == 200, per_unit.text
    assert float(per_unit.json()["maintenanceCost"]) == 100


async def test_included_support_edit_is_limited_to_included_perpetual_style_licenses(test_app, auth_headers):
    subscription = await _create(test_app, auth_headers, licenseType="subscription", endDate="2027-01-01")
    separately = await _create(test_app, auth_headers, maintenanceCoverage="separately_tracked")
    included = await _included_parent(test_app, auth_headers)

    body = {"maintenanceStartDate": "2026-01-01", "maintenanceEndDate": "2026-12-31"}
    assert (await test_app.put(f"/api/licenses/{subscription['id']}/included-support", json=body, headers=auth_headers)).status_code == 400
    assert (await test_app.put(f"/api/licenses/{separately['id']}/included-support", json=body, headers=auth_headers)).status_code == 400
    reversed_dates = await test_app.put(
        f"/api/licenses/{included['id']}/included-support",
        json={"maintenanceStartDate": "2026-12-31", "maintenanceEndDate": "2026-01-01"},
        headers=auth_headers,
    )
    assert reversed_dates.status_code == 422

"""Co-term renewal rules for mixed types and maintenance parent coverage."""

import json
from datetime import date, timedelta

from sqlalchemy import select

from app.models.license import License, LicenseMaintenanceLink
from app.services.maintenance_service import recompute_active_maintenance


def _payload(**overrides) -> dict:
    payload = {
        "publisherName": "Shared Publisher",
        "softwareDescription": "Shared Maintenance",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "unitPrice": "100",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
    }
    payload.update(overrides)
    return payload


async def _create(client, headers, **overrides) -> dict:
    response = await client.post("/api/licenses", json=_payload(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _parent(client, headers, description: str) -> dict:
    return await _create(
        client,
        headers,
        softwareDescription=description,
        licenseType="perpetual",
        startDate="2024-01-01",
        endDate=None,
    )


async def _maintenance(client, headers, parent_id: int) -> dict:
    end = date.today() + timedelta(days=10)
    return await _create(
        client,
        headers,
        licenseType="maintenance",
        parentLicenseId=parent_id,
        startDate=(end - timedelta(days=364)).isoformat(),
        endDate=end.isoformat(),
    )


async def _start_renewal(client, headers, license_id: int) -> dict:
    response = await client.post(f"/api/licenses/{license_id}/initiate-renewal", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["sourcingItem"]


async def _merge(client, headers, *item_ids: int):
    return await client.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": list(item_ids)},
        headers=headers,
    )


async def _convert_to_order(client, headers, item_id: int) -> dict:
    response = await client.post(
        f"/api/sourcing/{item_id}/convert",
        json={"poNumber": f"PO-COTERM-{item_id}", "supplier": "Renewal Supplier"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_coterm_merge_rejects_mixed_license_types(test_app, auth_headers):
    parent = await _parent(test_app, auth_headers, "Maintenance parent")
    maintenance = await _maintenance(test_app, auth_headers, parent["id"])
    end = date.today() + timedelta(days=10)
    subscription = await _create(
        test_app,
        auth_headers,
        startDate=(end - timedelta(days=364)).isoformat(),
        endDate=end.isoformat(),
    )
    maintenance_item = await _start_renewal(test_app, auth_headers, maintenance["id"])
    subscription_item = await _start_renewal(test_app, auth_headers, subscription["id"])

    response = await _merge(test_app, auth_headers, maintenance_item["id"], subscription_item["id"])

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Coterm merge requires the same license type."


async def test_coterm_maintenance_successor_covers_every_predecessor_parent(
    test_app,
    auth_headers,
    db_session,
):
    first_parent = await _parent(test_app, auth_headers, "First parent")
    second_parent = await _parent(test_app, auth_headers, "Second parent")
    first = await _maintenance(test_app, auth_headers, first_parent["id"])
    second = await _maintenance(test_app, auth_headers, second_parent["id"])
    first_item = await _start_renewal(test_app, auth_headers, first["id"])
    second_item = await _start_renewal(test_app, auth_headers, second["id"])
    merged_response = await _merge(test_app, auth_headers, first_item["id"], second_item["id"])
    assert merged_response.status_code == 201, merged_response.text
    merged = merged_response.json()
    order = await _convert_to_order(test_app, auth_headers, merged["id"])

    successor_start = date.today() + timedelta(days=11)
    successor_end = successor_start + timedelta(days=364)
    conversion = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={
            "data": json.dumps(
                _payload(
                    licenseType="maintenance",
                    startDate=successor_start.isoformat(),
                    endDate=successor_end.isoformat(),
                    purchaseDate=date.today().isoformat(),
                    poNumber=order["poNumber"],
                )
            )
        },
        headers=auth_headers,
    )
    assert conversion.status_code == 200, conversion.text
    successor = next(row for row in conversion.json() if row.get("renewedFromId") == first["id"])

    links = (
        await db_session.execute(
            select(LicenseMaintenanceLink).where(
                LicenseMaintenanceLink.maintenance_license_id == successor["id"]
            )
        )
    ).scalars().all()
    assert {link.parent_license_id for link in links} == {first_parent["id"], second_parent["id"]}

    for parent_id in (first_parent["id"], second_parent["id"]):
        parent = await db_session.get(License, parent_id)
        await recompute_active_maintenance(db_session, parent, today=successor_start)
    await db_session.commit()

    for parent_id in (first_parent["id"], second_parent["id"]):
        response = await test_app.get(f"/api/licenses/{parent_id}", headers=auth_headers)
        assert response.json()["activeMaintenanceId"] == successor["id"]

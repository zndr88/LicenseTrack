from datetime import date, timedelta

from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.license import License, LifecycleStatus
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus


def _license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "unitPrice": "100",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
        "endDate": (date.today() + timedelta(days=30)).isoformat(),
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post("/api/licenses", json=_license_payload(**overrides), headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_established_renewal_chain(client, headers, db_session) -> tuple[dict, dict]:
    predecessor = await _create_license(
        client,
        headers,
        softwareDescription="Established predecessor",
    )
    successor = await _create_license(
        client,
        headers,
        softwareDescription="Established successor",
    )

    predecessor_row = await db_session.get(License, predecessor["id"])
    successor_row = await db_session.get(License, successor["id"])
    predecessor_row.lifecycle_status = LifecycleStatus.renewed
    predecessor_row.renewed_to_id = successor_row.id
    successor_row.renewed_from_id = predecessor_row.id
    successor_row.predecessor_id = predecessor_row.id
    await db_session.commit()

    return predecessor, successor


async def _assert_reloaded_ancestry(client, headers, predecessor_id: int, successor_id: int) -> None:
    predecessor_resp = await client.get(f"/api/licenses/{predecessor_id}", headers=headers)
    successor_resp = await client.get(f"/api/licenses/{successor_id}", headers=headers)

    assert predecessor_resp.status_code == 200, predecessor_resp.text
    assert successor_resp.status_code == 200, successor_resp.text
    assert predecessor_resp.json()["renewedToId"] == successor_id
    assert successor_resp.json()["renewedFromId"] == predecessor_id
    assert successor_resp.json()["predecessorId"] == predecessor_id
    assert successor_resp.json()["lifecycleStatus"] is None


async def test_initiate_recurring_renewal_suggests_next_annual_term(test_app, auth_headers):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        startDate="2025-01-01",
        endDate="2025-12-31",
    )

    response = await test_app.post(
        f"/api/licenses/{predecessor['id']}/initiate-renewal",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    sourcing_item = response.json()["sourcingItem"]
    assert sourcing_item["startDate"] == "2026-01-01"
    assert sourcing_item["endDate"] == "2026-12-31"


async def test_cancel_successor_renewal_from_license_preserves_established_ancestry(
    test_app,
    db_session,
    auth_headers,
):
    predecessor, successor = await _create_established_renewal_chain(test_app, auth_headers, db_session)
    initiate_resp = await test_app.post(
        f"/api/licenses/{successor['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert initiate_resp.status_code == 200, initiate_resp.text
    pending_item = initiate_resp.json()["sourcingItem"]

    unrelated = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Unrelated pending renewal",
    )
    unrelated_initiate = await test_app.post(
        f"/api/licenses/{unrelated['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert unrelated_initiate.status_code == 200, unrelated_initiate.text
    unrelated_item = unrelated_initiate.json()["sourcingItem"]

    cancel_resp = await test_app.post(
        f"/api/licenses/{successor['id']}/cancel-renewal",
        headers=auth_headers,
    )

    assert cancel_resp.status_code == 200, cancel_resp.text
    cancelled_license = cancel_resp.json()["license"]
    assert cancelled_license["renewedFromId"] == predecessor["id"]
    assert cancelled_license["predecessorId"] == predecessor["id"]
    assert cancelled_license["lifecycleStatus"] is None
    await _assert_reloaded_ancestry(
        test_app,
        auth_headers,
        predecessor["id"],
        successor["id"],
    )

    db_session.expire_all()
    predecessor_row = await db_session.get(License, predecessor["id"])
    successor_row = await db_session.get(License, successor["id"])
    assert predecessor_row.renewed_to_id == successor_row.id
    assert successor_row.renewed_from_id == predecessor_row.id
    assert successor_row.predecessor_id == predecessor_row.id
    request_row = await db_session.get(SourcingRequest, pending_item["sourcingRequestId"])
    item_row = await db_session.get(SourcingItem, pending_item["id"])
    assert request_row.status == SourcingStatus.converted
    assert item_row.status == SourcingStatus.cancelled
    assert item_row.sourcing_request_id == request_row.id
    assert await db_session.get(SourcingItem, unrelated_item["id"]) is not None
    assert await db_session.get(SourcingRequest, unrelated_item["sourcingRequestId"]) is not None
    assert (
        await db_session.scalar(
            select(func.count(License.id)).where(
                (License.renewed_from_id == successor["id"]) | (License.predecessor_id == successor["id"])
            )
        )
        == 0
    )

    unrelated_resp = await test_app.get(f"/api/licenses/{unrelated['id']}", headers=auth_headers)
    assert unrelated_resp.status_code == 200, unrelated_resp.text
    assert unrelated_resp.json()["lifecycleStatus"] == "pending_renewal"
    audit_rows = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "sourcing_request.cancelled",
                AuditLog.target_id == str(request_row.id),
            )
        )
    ).scalars().all()
    assert audit_rows == []


async def test_cancel_successor_renewal_from_sourcing_preserves_established_ancestry(
    test_app,
    db_session,
    auth_headers,
):
    predecessor, successor = await _create_established_renewal_chain(test_app, auth_headers, db_session)
    initiate_resp = await test_app.post(
        f"/api/licenses/{successor['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert initiate_resp.status_code == 200, initiate_resp.text
    pending_item = initiate_resp.json()["sourcingItem"]

    cancel_resp = await test_app.post(
        f"/api/sourcing/requests/{pending_item['sourcingRequestId']}/cancel",
        headers=auth_headers,
    )

    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["status"] == "cancelled"
    assert cancel_resp.json()["items"][0]["status"] == "cancelled"
    await _assert_reloaded_ancestry(
        test_app,
        auth_headers,
        predecessor["id"],
        successor["id"],
    )

    db_session.expire_all()
    predecessor_row = await db_session.get(License, predecessor["id"])
    successor_row = await db_session.get(License, successor["id"])
    request_row = await db_session.get(SourcingRequest, pending_item["sourcingRequestId"])
    item_row = await db_session.get(SourcingItem, pending_item["id"])
    assert predecessor_row.renewed_to_id == successor_row.id
    assert successor_row.renewed_from_id == predecessor_row.id
    assert successor_row.predecessor_id == predecessor_row.id
    assert request_row.status == SourcingStatus.cancelled
    assert item_row.status == SourcingStatus.cancelled
    assert item_row.sourcing_request_id == request_row.id
    assert (
        await db_session.scalar(
            select(func.count(License.id)).where(
                (License.renewed_from_id == successor["id"]) | (License.predecessor_id == successor["id"])
            )
        )
        == 0
    )

    audit_rows = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "sourcing_request.cancelled",
                AuditLog.target_id == str(request_row.id),
            )
        )
    ).scalars().all()
    assert len(audit_rows) == 1


async def test_cancel_renewal_cancels_multiple_sourcing_only_items(
    test_app,
    db_session,
    auth_headers,
):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Duplicate Renewal Source",
    )
    initiate_resp = await test_app.post(
        f"/api/licenses/{license_data['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert initiate_resp.status_code == 200, initiate_resp.text

    duplicate_request = SourcingRequest(
        supplier="Acme Direct",
        status=SourcingStatus.sourcing,
    )
    db_session.add(duplicate_request)
    await db_session.flush()
    db_session.add(
        SourcingItem(
            sourcing_request_id=duplicate_request.id,
            publisher_name=license_data["publisherName"],
            software_description=license_data["softwareDescription"],
            quantity=license_data["quantity"],
            currency=license_data["currency"],
            status=SourcingStatus.sourcing,
            renewal_for_license_id=license_data["id"],
        )
    )
    await db_session.commit()

    before_count = await db_session.scalar(
        select(func.count(SourcingItem.id)).where(
            SourcingItem.renewal_for_license_id == license_data["id"],
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    assert before_count == 2

    cancel_resp = await test_app.post(
        f"/api/licenses/{license_data['id']}/cancel-renewal",
        headers=auth_headers,
    )

    assert cancel_resp.status_code == 200, cancel_resp.text
    body = cancel_resp.json()
    assert body["license"]["lifecycleStatus"] is None
    assert body["poWarning"] is False

    remaining_items = await db_session.scalar(
        select(func.count(SourcingItem.id)).where(
            SourcingItem.renewal_for_license_id == license_data["id"],
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    assert remaining_items == 0

    completed_requests = await db_session.scalar(
        select(func.count(SourcingRequest.id)).where(
            SourcingRequest.status == SourcingStatus.converted,
        )
    )
    assert completed_requests == 2


async def test_cancel_secondary_coterm_predecessor_rejects_grouped_renewal(
    test_app,
    db_session,
    auth_headers,
):
    primary = await _create_license(test_app, auth_headers, softwareDescription="Primary Coterm")
    secondary = await _create_license(test_app, auth_headers, softwareDescription="Secondary Coterm")
    primary_row = await db_session.get(License, primary["id"])
    secondary_row = await db_session.get(License, secondary["id"])
    primary_row.lifecycle_status = "pending_renewal"
    secondary_row.lifecycle_status = "pending_renewal"
    request = SourcingRequest(supplier="Acme Direct", status=SourcingStatus.sourcing)
    db_session.add(request)
    await db_session.flush()
    db_session.add(
        SourcingItem(
            sourcing_request_id=request.id,
            publisher_name="Acme",
            software_description="Grouped coterm renewal",
            status=SourcingStatus.sourcing,
            renewal_for_license_id=primary["id"],
            coterm_predecessor_ids=[primary["id"], secondary["id"]],
        )
    )
    await db_session.commit()

    response = await test_app.post(
        f"/api/licenses/{secondary['id']}/cancel-renewal",
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "coterm sourcing line" in response.json()["detail"]

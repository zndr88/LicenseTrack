"""Integration tests for pending order conversion flows."""

import asyncio
import json
from datetime import date, timedelta

from sqlalchemy import select, text

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.license import (
    License,
    LicenseCoverageHistory,
    LicenseMaintenanceLink,
    LicenseMetric,
    LicenseType,
    MaintenanceCoverage,
)
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.services import pending_order_conversion_service as _conversion_service
from app.services import storage as _storage_module
from app.models.pending_order import EvidenceTransferStatus, PendingOrder, PendingOrderStatus


def _minimal_license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post(
        "/api/licenses",
        json=_minimal_license_payload(**overrides),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_parent_with_maintenance(client, headers) -> tuple[dict, dict]:
    parent = await _create_license(
        client,
        headers,
        licenseType="perpetual",
        softwareDescription="Acme Server",
        startDate="2025-01-01",
        endDate=None,
        totalPoPrice="12000",
    )
    maintenance = await _create_license(
        client,
        headers,
        licenseType="maintenance",
        softwareDescription="Acme Server Maintenance",
        parentLicenseId=parent["id"],
        quantity="1",
        startDate="2025-01-01",
        endDate="2025-12-31",
        unitPrice="2500",
        totalPoPrice="2500",
    )
    return parent, maintenance


async def _seed_legacy_unlinked_maintenance(db_session) -> License:
    maintenance = License(
        publisher_name="Legacy Publisher",
        software_description="Legacy Renewal Maintenance",
        license_type=LicenseType.maintenance,
        license_metric=LicenseMetric.per_user,
        maintenance_coverage=MaintenanceCoverage.not_applicable,
        currency="EUR",
        start_date=date.today() - timedelta(days=30),
        end_date=date.today() + timedelta(days=30),
        budget_owner_email="owner@example.com",
        is_legacy_unlinked_maintenance=True,
    )
    db_session.add(maintenance)
    await db_session.commit()
    await db_session.refresh(maintenance)
    return maintenance


async def _initiate_renewal(client, headers, license_id: int) -> dict:
    resp = await client.post(
        f"/api/licenses/{license_id}/initiate-renewal",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["sourcingItem"]


async def _convert_sourcing_to_po(client, headers, sourcing_item_id: int) -> dict:
    resp = await client.post(
        f"/api/sourcing/{sourcing_item_id}/convert",
        json={
            "poNumber": f"PO-{sourcing_item_id}",
            "supplier": "Renewal Supplier",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _attach_sourcing_to_po(client, headers, sourcing_item_id: int, order_id: int) -> dict:
    item_resp = await client.get(f"/api/sourcing/{sourcing_item_id}", headers=headers)
    assert item_resp.status_code == 200, item_resp.text
    request_id = item_resp.json()["sourcingRequestId"]
    request_update = await client.put(
        f"/api/sourcing/requests/{request_id}",
        json={"supplier": "Renewal Supplier"},
        headers=headers,
    )
    assert request_update.status_code == 200, request_update.text
    resp = await client.post(
        f"/api/sourcing/{sourcing_item_id}/convert",
        json={
            "pendingOrderId": order_id,
            "supplier": "Renewal Supplier",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _create_sourcing_item(client, headers, **overrides) -> dict:
    payload = {
        "publisherName": "Sourcing Publisher",
        "softwareDescription": "Sourcing App",
        "quantity": "4",
        "estimatedUnitPrice": "25",
        "estimatedTotalPrice": "100",
        "currency": "EUR",
        "supplier": "Sourcing Supplier",
    }
    payload.update(overrides)
    resp = await client.post("/api/sourcing", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_sourcing_item_list_hides_items_under_converted_requests(test_app, auth_headers, db_session):
    request = SourcingRequest(
        supplier="Converted Supplier",
        status=SourcingStatus.converted,
    )
    db_session.add(request)
    await db_session.flush()

    visible_item = SourcingItem(
        publisher_name="Visible Publisher",
        software_description="Visible App",
        quantity="1",
        currency="EUR",
        status=SourcingStatus.sourcing,
    )
    hidden_item = SourcingItem(
        sourcing_request_id=request.id,
        publisher_name="Hidden Publisher",
        software_description="Floating App",
        quantity="1",
        currency="EUR",
        status=SourcingStatus.sourcing,
    )
    db_session.add_all([visible_item, hidden_item])
    await db_session.commit()

    resp = await test_app.get("/api/sourcing", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    descriptions = {item["softwareDescription"] for item in resp.json()}

    assert "Visible App" in descriptions
    assert "Floating App" not in descriptions


async def test_cancelled_sourcing_request_moves_to_history(test_app, auth_headers, db_session):
    item = await _create_sourcing_item(
        test_app,
        auth_headers,
        supplier="Paused Supplier",
        softwareDescription="Paused App",
    )
    request_id = item["sourcingRequestId"]

    cancel_resp = await test_app.post(f"/api/sourcing/requests/{request_id}/cancel", headers=auth_headers)
    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["status"] == "cancelled"
    assert cancel_resp.json()["items"][0]["status"] == "cancelled"

    active_resp = await test_app.get("/api/sourcing/requests", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    assert request_id not in {request["id"] for request in active_resp.json()}

    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history = {request["id"]: request for request in history_resp.json()}
    assert request_id in history
    assert history[request_id]["supplier"] == "Paused Supplier"
    assert history[request_id]["items"][0]["softwareDescription"] == "Paused App"

    db_session.expire_all()
    request_obj = await db_session.get(SourcingRequest, request_id)
    item_obj = await db_session.get(SourcingItem, item["id"])
    assert request_obj.status == SourcingStatus.cancelled
    assert item_obj.status == SourcingStatus.cancelled


async def test_sourcing_history_includes_pending_order_status(test_app, auth_headers):
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="History PO Status App",
    )
    request_id = sourcing_item["sourcingRequestId"]
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history = {request["id"]: request for request in history_resp.json()}
    history_item = history[request_id]["items"][0]
    assert history_item["pendingOrderId"] == po["id"]
    assert history_item["pendingOrderStatus"] == "pending"
    assert history_item["pendingOrderPoNumber"] == po["poNumber"]

    convert_resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber=po["poNumber"]))},
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text

    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history = {request["id"]: request for request in history_resp.json()}
    assert history[request_id]["items"][0]["pendingOrderStatus"] == "converted"


async def test_freeware_sourcing_item_converts_directly_to_registry(test_app, auth_headers):
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        publisherName="The Document Foundation",
        softwareDescription="LibreOffice Calc",
        licenseType="freeware",
        quantity="1",
        estimatedUnitPrice=None,
        estimatedTotalPrice=None,
        startDate="2026-07-23",
        supplier="Direct",
    )

    resp = await test_app.post(
        f"/api/sourcing/{sourcing_item['id']}/convert-freeware",
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    license_obj = resp.json()
    assert license_obj["licenseType"] == "freeware"
    assert license_obj["sourceSourcingItemId"] == sourcing_item["id"]
    assert license_obj["requestDate"] == sourcing_item["createdAt"]
    assert license_obj["purchaseDate"] is None
    assert license_obj["pendingOrderId"] is None
    assert license_obj["poNumber"] == ""
    assert license_obj["invoiceNumber"] == ""
    assert license_obj["contractNumber"] == ""
    assert license_obj["unitPrice"] == ""
    assert license_obj["totalPoPrice"] == ""
    assert license_obj["conversionType"] == "direct_freeware"

    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history_item = next(
        request["items"][0]
        for request in history_resp.json()
        if request["id"] == sourcing_item["sourcingRequestId"]
    )
    assert history_item["convertedLicenseId"] == license_obj["id"]
    assert history_item["convertedLicenseRef"] == license_obj["licenseRef"]
    assert history_item["convertedLicenseIds"] == [license_obj["id"]]


async def test_non_freeware_sourcing_item_cannot_bypass_pending_orders(test_app, auth_headers):
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        licenseType="oem",
    )

    resp = await test_app.post(
        f"/api/sourcing/{sourcing_item['id']}/convert-freeware",
        headers=auth_headers,
    )

    assert resp.status_code == 422
    assert "is not Freeware / Open Source" in resp.json()["detail"]


async def test_freeware_sourcing_request_converts_directly_to_registry(test_app, auth_headers):
    request_resp = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Community Supplier",
            "items": [
                {
                    "publisherName": "Community Publisher",
                    "softwareDescription": "Community App A",
                    "licenseType": "freeware",
                },
                {
                    "publisherName": "Community Publisher",
                    "softwareDescription": "Community App B",
                    "licenseType": "freeware",
                },
            ],
        },
        headers=auth_headers,
    )
    assert request_resp.status_code == 201, request_resp.text
    request = request_resp.json()

    response = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert-freeware",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert len(response.json()) == 2
    assert {license_obj["licenseType"] for license_obj in response.json()} == {"freeware"}
    request_state = await test_app.get(
        f"/api/sourcing/requests/{request['id']}",
        headers=auth_headers,
    )
    assert request_state.json()["status"] == "converted"


async def test_mixed_sourcing_request_splits_freeware_to_registry_and_paid_line_to_po(test_app, auth_headers):
    request_resp = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Mixed Supplier",
            "items": [
                {
                    "publisherName": "Paid Publisher",
                    "softwareDescription": "Paid App",
                    "licenseType": "subscription",
                    "quantity": "2",
                    "currency": "EUR",
                },
                {
                    "publisherName": "Community Publisher",
                    "softwareDescription": "Community App",
                    "licenseType": "freeware",
                    "quantity": "1",
                    "currency": "EUR",
                },
            ],
        },
        headers=auth_headers,
    )
    assert request_resp.status_code == 201, request_resp.text
    request = request_resp.json()
    paid_item, freeware_item = request["items"]

    po_resp = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert",
        json={"poNumber": "PO-MIXED"},
        headers=auth_headers,
    )
    assert po_resp.status_code == 200, po_resp.text
    assert [item["id"] for item in po_resp.json()["items"]] == [paid_item["id"]]
    assert po_resp.json()["directRegistryCount"] == 1

    active_resp = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    active = active_resp.json()
    assert active["status"] == "converted"
    assert next(item for item in active["items"] if item["id"] == freeware_item["id"])["status"] == "converted"

    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    history = {item["id"]: item for item in history_resp.json()}
    assert history[request["id"]]["status"] == "converted"


async def test_coordinated_mixed_conversion_closes_request(test_app, auth_headers):
    request_resp = await test_app.post(
        "/api/sourcing/requests",
        json={
            "items": [
                {
                    "publisherName": "Paid Publisher",
                    "softwareDescription": "Paid App",
                    "licenseType": "subscription",
                },
                {
                    "publisherName": "Community Publisher",
                    "softwareDescription": "Community App",
                    "licenseType": "freeware",
                },
            ],
        },
        headers=auth_headers,
    )
    request = request_resp.json()
    paid_item, freeware_item = request["items"]
    po_resp = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert",
        json={"poNumber": "PO-MIXED-CANCEL", "supplier": "Mixed Supplier"},
        headers=auth_headers,
    )
    assert po_resp.status_code == 200, po_resp.text

    cancel_resp = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/cancel",
        headers=auth_headers,
    )

    assert cancel_resp.status_code == 409, cancel_resp.text

    request_state = await test_app.get(
        f"/api/sourcing/requests/{request['id']}",
        headers=auth_headers,
    )
    items = {item["id"]: item for item in request_state.json()["items"]}
    assert items[paid_item["id"]]["status"] == "converted"
    assert items[paid_item["id"]]["pendingOrderId"] == po_resp.json()["id"]
    assert items[freeware_item["id"]]["status"] == "converted"


async def test_pending_order_list_can_include_converted_evidence_issues(
    test_app,
    auth_headers,
    db_session,
):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-EVIDENCE-ISSUE", "supplier": "Evidence Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    order = await db_session.get(PendingOrder, order_id)
    order.status = PendingOrderStatus.converted
    order.evidence_transfer_status = EvidenceTransferStatus.failed
    order.evidence_transfer_detail = "storage failed"
    await db_session.commit()

    default_resp = await test_app.get("/api/pending-orders", headers=auth_headers)
    assert default_resp.status_code == 200, default_resp.text
    assert order_id not in {item["id"] for item in default_resp.json()}

    issue_resp = await test_app.get(
        "/api/pending-orders?include_evidence_issues=true",
        headers=auth_headers,
    )
    assert issue_resp.status_code == 200, issue_resp.text
    issue_orders = {item["id"]: item for item in issue_resp.json()}
    assert issue_orders[order_id]["status"] == "converted"
    assert issue_orders[order_id]["evidenceTransferStatus"] == "failed"
    assert issue_orders[order_id]["evidenceTransferDetail"] == "storage failed"


async def test_pending_order_update_can_mark_invoice_received_but_not_converted(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-STATUS-UPDATE", "supplier": "Status Supplier"},
        headers=auth_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    order_id = create_resp.json()["id"]

    received_resp = await test_app.put(
        f"/api/pending-orders/{order_id}",
        json={"status": "invoice_received"},
        headers=auth_headers,
    )
    assert received_resp.status_code == 200, received_resp.text
    assert received_resp.json()["status"] == "invoice_received"

    converted_resp = await test_app.put(
        f"/api/pending-orders/{order_id}",
        json={"status": "converted"},
        headers=auth_headers,
    )
    assert converted_resp.status_code == 422, converted_resp.text
    assert "pending or invoice_received" in converted_resp.json()["detail"]


async def test_pending_order_create_accepts_header_and_lines_atomically(
    test_app,
    auth_headers,
    db_session,
):
    create_resp = await test_app.post(
        "/api/pending-orders",
        json={
            "poNumber": "PO-ATOMIC-CREATE",
            "supplier": "Atomic Supplier",
            "items": [
                {
                    "publisherName": "Acme",
                    "softwareDescription": "Acme Suite",
                    "quantity": "2",
                    "estimatedUnitPrice": "50",
                    "estimatedTotalPrice": "100",
                    "currency": "EUR",
                },
                {
                    "publisherName": "Beta",
                    "softwareDescription": "Beta Tool",
                    "quantity": "1",
                    "currency": "USD",
                },
            ],
        },
        headers=auth_headers,
    )

    assert create_resp.status_code == 201, create_resp.text
    body = create_resp.json()
    assert body["poNumber"] == "PO-ATOMIC-CREATE"
    assert [item["softwareDescription"] for item in body["items"]] == [
        "Acme Suite",
        "Beta Tool",
    ]
    stored = await db_session.get(PendingOrder, body["id"])
    await db_session.refresh(stored, attribute_names=["items"])
    assert len(stored.items) == 2
    assert {item.pending_order_id for item in stored.items} == {stored.id}


async def test_cancelled_pending_order_moves_to_history(test_app, auth_headers, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-PAUSED", "supplier": "Paused Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    add_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk",
        json=[
            {
                "publisherName": "Paused Publisher",
                "softwareDescription": "Paused Subscription",
                "quantity": "3",
                "estimatedUnitPrice": "20",
                "estimatedTotalPrice": "60",
                "currency": "EUR",
            }
        ],
        headers=auth_headers,
    )
    assert add_resp.status_code == 201, add_resp.text
    item_id = add_resp.json()["items"][0]["id"]

    upload_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/documents",
        files={"file": ("paused-po.pdf", b"purchase order", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text

    cancel_resp = await test_app.post(f"/api/pending-orders/{order_id}/cancel", headers=auth_headers)
    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["status"] == "cancelled"
    assert cancel_resp.json()["items"][0]["status"] == "cancelled"
    assert cancel_resp.json()["documents"][0]["original_filename"] == "paused-po.pdf"

    active_resp = await test_app.get("/api/pending-orders", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    assert order_id not in {order["id"] for order in active_resp.json()}

    history_resp = await test_app.get("/api/pending-orders/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history = {order["id"]: order for order in history_resp.json()}
    assert history[order_id]["poNumber"] == "PO-PAUSED"
    assert history[order_id]["items"][0]["softwareDescription"] == "Paused Subscription"
    assert history[order_id]["documents"][0]["original_filename"] == "paused-po.pdf"

    convert_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-PAUSED"))},
        headers=auth_headers,
    )
    assert convert_resp.status_code == 409
    assert convert_resp.json()["detail"] == "Pending order has been cancelled"

    db_session.expire_all()
    order_obj = await db_session.get(PendingOrder, order_id)
    item_obj = await db_session.get(SourcingItem, item_id)
    assert order_obj.status == PendingOrderStatus.cancelled
    assert item_obj.status == SourcingStatus.cancelled


async def test_converted_pending_order_moves_to_history(test_app, auth_headers):
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        publisherName="History Publisher",
        softwareDescription="History Subscription",
        estimatedTotalPrice="75",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    order_id = po["id"]

    convert_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    poNumber=po["poNumber"],
                    publisherName="History Publisher",
                    softwareDescription="History Subscription",
                )
            )
        },
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    created_license = convert_resp.json()[0]
    assert created_license["sourceSourcingItemId"] == sourcing_item["id"]

    active_resp = await test_app.get("/api/pending-orders", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    assert order_id not in {order["id"] for order in active_resp.json()}

    history_resp = await test_app.get("/api/pending-orders/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history = {order["id"]: order for order in history_resp.json()}
    assert history[order_id]["status"] == "converted"
    assert history[order_id]["poNumber"] == po["poNumber"]
    assert history[order_id]["convertedLicenseId"] == created_license["id"]
    assert history[order_id]["convertedLicenseIds"] == [created_license["id"]]
    assert history[order_id]["convertedLicenseRef"] == created_license["licenseRef"]
    assert history[order_id]["items"][0]["convertedLicenseId"] == created_license["id"]
    assert history[order_id]["items"][0]["convertedLicenseIds"] == [created_license["id"]]
    assert history[order_id]["items"][0]["convertedLicenseRef"] == created_license["licenseRef"]

    trail_resp = await test_app.get(
        f"/api/licenses/{created_license['id']}/procurement-trail",
        headers=auth_headers,
    )
    assert trail_resp.status_code == 200, trail_resp.text
    trail = trail_resp.json()
    assert trail["licenseId"] == created_license["id"]
    assert trail["pendingOrder"]["id"] == order_id
    assert trail["pendingOrder"]["status"] == "converted"
    assert trail["sourcingRequest"]["id"] == sourcing_item["sourcingRequestId"]
    assert trail["sourcingItem"]["id"] == sourcing_item["id"]
    assert trail["sourcingItem"]["estimatedTotalPrice"] == "75"
    assert trail["conversion"]["sourceSourcingItemId"] == sourcing_item["id"]
    assert trail["conversion"]["sourceMatchType"] == "exact"


async def test_converted_sourcing_item_update_delete_and_reconvert_are_rejected(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Locked Source App")
    await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    update_resp = await test_app.put(
        f"/api/sourcing/{item['id']}",
        json={"softwareDescription": "Should Not Change"},
        headers=auth_headers,
    )
    delete_resp = await test_app.delete(
        f"/api/sourcing/{item['id']}",
        headers=auth_headers,
    )
    convert_resp = await test_app.post(
        f"/api/sourcing/{item['id']}/convert",
        json={"poNumber": "PO-SHOULD-NOT-RECONVERT"},
        headers=auth_headers,
    )

    assert update_resp.status_code == 409
    assert delete_resp.status_code == 409
    assert convert_resp.status_code == 409


async def test_renewal_bundle_creates_one_request_with_distinct_lines(test_app, auth_headers, db_session):
    first = await _create_license(
        test_app,
        auth_headers,
        publisherName="SideFX",
        softwareDescription="Houdini Indie Annual License",
        poNumber="PO-BUNDLE-1",
        endDate="2026-12-31",
        skuCode="SIDEFX-INDIE",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        publisherName="SideFX",
        softwareDescription="Houdini Pro Annual License",
        poNumber="PO-BUNDLE-1",
        endDate="2026-12-31",
        skuCode="SIDEFX-PRO",
    )

    resp = await test_app.post(
        "/api/licenses/renewal-bundle/initiate",
        json={"licenseIds": [first["id"], second["id"]]},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {license_row["id"] for license_row in body["licenses"]} == {first["id"], second["id"]}
    assert {license_row["lifecycleStatus"] for license_row in body["licenses"]} == {"pending_renewal"}
    request = body["sourcingRequest"]
    assert len(request["items"]) == 2
    assert {item["softwareDescription"] for item in request["items"]} == {
        "Houdini Indie Annual License",
        "Houdini Pro Annual License",
    }
    assert len({item["sourcingRequestId"] for item in request["items"]}) == 1
    assert request["items"][0]["sourcingRequestId"] == request["id"]

    db_session.expire_all()
    db_items = (
        await db_session.execute(
            select(SourcingItem).where(SourcingItem.renewal_for_license_id.in_([first["id"], second["id"]]))
        )
    ).scalars().all()
    assert len(db_items) == 2
    assert len({item.sourcing_request_id for item in db_items}) == 1

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [item.id for item in db_items]},
        headers=auth_headers,
    )
    assert merge_resp.status_code == 400
    assert merge_resp.json()["detail"] == "Coterm merge requires the same software description."


async def test_coterm_merge_deletes_empty_original_sourcing_requests(
    test_app,
    auth_headers,
    db_session,
):
    first = await _create_license(
        test_app,
        auth_headers,
        startDate="2024-01-01",
        endDate="2025-12-31",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_first = await _initiate_renewal(test_app, auth_headers, first["id"])
    sourcing_second = await _initiate_renewal(test_app, auth_headers, second["id"])
    original_request_ids = {
        sourcing_first["sourcingRequestId"],
        sourcing_second["sourcingRequestId"],
    }
    assert len(original_request_ids) == 2

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_first["id"], sourcing_second["id"]]},
        headers=auth_headers,
    )

    assert merge_resp.status_code == 201, merge_resp.text
    merged = merge_resp.json()
    assert merged["sourcingRequestId"] not in original_request_ids
    db_session.expire_all()
    assert await db_session.get(SourcingItem, sourcing_first["id"]) is None
    assert await db_session.get(SourcingItem, sourcing_second["id"]) is None
    for request_id in original_request_ids:
        assert await db_session.get(SourcingRequest, request_id) is None
    assert await db_session.get(SourcingItem, merged["id"]) is not None
    assert await db_session.get(SourcingRequest, merged["sourcingRequestId"]) is not None

    active_resp = await test_app.get("/api/sourcing/requests", headers=auth_headers)
    history_resp = await test_app.get("/api/sourcing/requests/history", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    assert history_resp.status_code == 200, history_resp.text
    active_ids = {request["id"] for request in active_resp.json()}
    history_ids = {request["id"] for request in history_resp.json()}
    assert merged["sourcingRequestId"] in active_ids
    assert original_request_ids.isdisjoint(active_ids)
    assert original_request_ids.isdisjoint(history_ids)


async def test_coterm_merge_preserves_original_request_with_unrelated_item(
    test_app,
    auth_headers,
    db_session,
):
    first = await _create_license(
        test_app,
        auth_headers,
        startDate="2024-01-01",
        endDate="2025-12-31",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_first = await _initiate_renewal(test_app, auth_headers, first["id"])
    sourcing_second = await _initiate_renewal(test_app, auth_headers, second["id"])
    retained_request_id = sourcing_first["sourcingRequestId"]
    empty_request_id = sourcing_second["sourcingRequestId"]
    assert retained_request_id != empty_request_id

    unrelated = SourcingItem(
        sourcing_request_id=retained_request_id,
        publisher_name="Unrelated Publisher",
        software_description="Unrelated Item",
        quantity="7",
        currency="USD",
        notes="Must survive coterm merge",
        status=SourcingStatus.sourcing,
    )
    db_session.add(unrelated)
    await db_session.commit()
    unrelated_id = unrelated.id

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_first["id"], sourcing_second["id"]]},
        headers=auth_headers,
    )

    assert merge_resp.status_code == 201, merge_resp.text
    merged = merge_resp.json()
    db_session.expire_all()
    assert await db_session.get(SourcingItem, sourcing_first["id"]) is None
    assert await db_session.get(SourcingItem, sourcing_second["id"]) is None
    retained_request = await db_session.get(SourcingRequest, retained_request_id)
    assert retained_request is not None
    assert retained_request.status == SourcingStatus.sourcing
    assert await db_session.get(SourcingRequest, empty_request_id) is None
    retained_item = await db_session.get(SourcingItem, unrelated_id)
    assert retained_item is not None
    assert retained_item.sourcing_request_id == retained_request_id
    assert retained_item.software_description == "Unrelated Item"
    assert retained_item.quantity == "7"
    assert retained_item.currency == "USD"
    assert retained_item.notes == "Must survive coterm merge"
    assert await db_session.get(SourcingRequest, merged["sourcingRequestId"]) is not None

    active_resp = await test_app.get("/api/sourcing/requests", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    active_ids = {request["id"] for request in active_resp.json()}
    assert retained_request_id in active_ids
    assert empty_request_id not in active_ids
    assert merged["sourcingRequestId"] in active_ids


async def test_coterm_merge_rejects_free_form_quantity_without_deleting_source_work(
    test_app,
    auth_headers,
    db_session,
):
    first = await _create_license(test_app, auth_headers, endDate="2025-12-31")
    second = await _create_license(test_app, auth_headers, endDate="2025-12-31")
    sourcing_first = await _initiate_renewal(test_app, auth_headers, first["id"])
    sourcing_second = await _initiate_renewal(test_app, auth_headers, second["id"])
    first_item = await db_session.get(SourcingItem, sourcing_first["id"])
    first_item.quantity = "25 seats"
    await db_session.commit()

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_first["id"], sourcing_second["id"]]},
        headers=auth_headers,
    )

    assert merge_resp.status_code == 400, merge_resp.text
    assert "25 seats" in merge_resp.json()["detail"]
    db_session.expire_all()
    assert await db_session.get(SourcingItem, sourcing_first["id"]) is not None
    assert await db_session.get(SourcingItem, sourcing_second["id"]) is not None
    assert await db_session.get(SourcingRequest, sourcing_first["sourcingRequestId"]) is not None
    assert await db_session.get(SourcingRequest, sourcing_second["sourcingRequestId"]) is not None


def _single_convert_form(**overrides) -> dict:
    base = {
        "publisherName": "Shared Publisher",
        "softwareDescription": "Shared Description",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "unitPrice": "1",
        "totalPoPrice": "1",
        "currency": "EUR",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "purchaseDate": "2026-02-01",
        "poNumber": "PO-RENEW",
    }
    base.update(overrides)
    return base


def _batch_convert_item(sourcing_item_id: int, **overrides) -> dict:
    base = {
        "sourcingItemId": sourcing_item_id,
        "publisherName": "Batch Publisher",
        "softwareDescription": "Batch App",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "4",
        "unitPrice": "25",
        "totalPoPrice": "100",
        "currency": "EUR",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "purchaseDate": "2026-02-01",
        "poNumber": "PO-BATCH",
    }
    base.update(overrides)
    return base


async def _get_license(client, headers, license_id: int) -> dict:
    resp = await client.get(f"/api/licenses/{license_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _new_successor(converted: list[dict], predecessor_id: int) -> dict:
    for item in converted:
        if item.get("renewedFromId") == predecessor_id:
            return item
    raise AssertionError(f"No successor found for predecessor {predecessor_id}: {converted}")


def _assert_license_fields(license_data: dict, expected: dict) -> None:
    for field, value in expected.items():
        assert license_data[field] == value, field


async def _complete_single_renewal(client, headers, predecessor_id: int, **form_overrides) -> dict:
    sourcing_item = await _initiate_renewal(client, headers, predecessor_id)
    order = await _convert_sourcing_to_po(client, headers, sourcing_item["id"])
    response = await client.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={"data": json.dumps(_single_convert_form(**form_overrides))},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return _new_successor(response.json(), predecessor_id)


async def test_convert_pending_order_without_items_creates_license(test_app, auth_headers):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-NORMAL", "supplier": "Normal Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text

    resp = await test_app.post(
        f"/api/pending-orders/{order_resp.json()['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-NORMAL"))},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert len(converted) == 1
    assert converted[0]["conversionType"] == "new_purchase"
    assert converted[0]["poNumber"] == "PO-NORMAL"
    assert converted[0]["requestDate"] is None
    assert converted[0]["purchaseDate"] == "2026-02-01T00:00:00"

    second_resp = await test_app.post(
        f"/api/pending-orders/{order_resp.json()['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-NORMAL"))},
        headers=auth_headers,
    )
    assert second_resp.status_code == 409


async def test_convert_pending_order_without_items_preserves_saas_portal_url(test_app, auth_headers):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-SAAS", "supplier": "SaaS Supplier"},
        headers=auth_headers,
    )

    resp = await test_app.post(
        f"/api/pending-orders/{order_resp.json()['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    poNumber="PO-SAAS",
                    licenseType="saas",
                    portalUrl="https://portal.example.com",
                )
            )
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert converted[0]["licenseType"] == "saas"
    assert converted[0]["portalUrl"] == "https://portal.example.com"


async def test_convert_pending_order_can_create_maintenance_for_existing_parent(
    test_app, auth_headers
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        softwareDescription="Existing Perpetual",
        startDate="2026-01-01",
        endDate=None,
    )
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-MAINT-ONLY", "supplier": "Support Supplier"},
        headers=auth_headers,
    )

    resp = await test_app.post(
        f"/api/pending-orders/{order_resp.json()['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    poNumber="PO-MAINT-ONLY",
                    softwareDescription="Existing Perpetual Maintenance",
                    licenseType="maintenance",
                    parentLicenseId=parent["id"],
                    quantity="2",
                    unitPrice="250",
                    endDate="2027-12-31",
                    totalPoPrice="999",
                )
            )
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    maintenance = resp.json()[0]
    assert maintenance["licenseType"] == "maintenance"
    assert maintenance["parentLicenseId"] == parent["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == maintenance["id"]
    assert parent_after["maintenanceEndDate"] == "2027-12-31"
    assert parent_after["maintenanceCost"] == "500"


async def test_batch_convert_all_new_purchase_items(test_app, auth_headers):
    first = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Batch App One",
        estimatedTotalPrice="100",
    )
    second = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Batch App Two",
        estimatedTotalPrice="200",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, first["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, second["id"], po["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            _batch_convert_item(first["id"], softwareDescription="Batch App One"),
            _batch_convert_item(second["id"], softwareDescription="Batch App Two", totalPoPrice="200"),
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert [item["conversionType"] for item in converted] == ["new_purchase", "new_purchase"]
    assert {item["softwareDescription"] for item in converted} == {"Batch App One", "Batch App Two"}
    assert converted[0]["portalUrl"] is None
    by_description = {item["softwareDescription"]: item for item in converted}
    assert by_description["Batch App One"]["requestDate"] == first["createdAt"]
    assert by_description["Batch App Two"]["requestDate"] == second["createdAt"]
    assert {item["purchaseDate"] for item in converted} == {"2026-02-01T00:00:00"}


async def test_pending_order_can_wait_for_po_before_active_license_conversion(test_app, auth_headers):
    item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Awaiting PO App",
        estimatedTotalPrice="100",
    )

    order_resp = await test_app.post(
        f"/api/sourcing/{item['id']}/convert",
        json={
            "supplier": "Renewal Supplier",
            "procurementReference": "REQ-2026-77",
        },
        headers=auth_headers,
    )
    assert order_resp.status_code == 200, order_resp.text
    order = order_resp.json()
    assert order["poNumber"] == ""
    assert order["procurementReference"] == "REQ-2026-77"

    blocked_resp = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[
            _batch_convert_item(
                item["id"],
                softwareDescription="Awaiting PO App",
                poNumber="",
            ),
        ],
        headers=auth_headers,
    )
    assert blocked_resp.status_code == 422, blocked_resp.text
    assert "Add a PO number" in blocked_resp.json()["detail"]

    update_resp = await test_app.put(
        f"/api/pending-orders/{order['id']}",
        json={"poNumber": "PO-LATE-77"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200, update_resp.text

    convert_resp = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[
            _batch_convert_item(
                item["id"],
                softwareDescription="Awaiting PO App",
                poNumber="PO-LATE-77",
            ),
        ],
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    converted = convert_resp.json()[0]
    assert converted["poNumber"] == "PO-LATE-77"
    assert converted["procurementReference"] == "REQ-2026-77"


async def test_batch_convert_links_new_maintenance_to_same_purchase_perpetual(
    test_app, auth_headers
):
    parent_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Perpetual Product",
        estimatedTotalPrice="1000",
    )
    maintenance_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Perpetual Product Maintenance",
        estimatedTotalPrice="200",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, parent_item["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, maintenance_item["id"], po["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            _batch_convert_item(
                maintenance_item["id"],
                softwareDescription="Perpetual Product Maintenance",
                licenseType="maintenance",
                parentSourcingItemId=parent_item["id"],
                quantity="2",
                unitPrice="100",
                endDate="2027-12-31",
                totalPoPrice="999",
            ),
            _batch_convert_item(
                parent_item["id"],
                softwareDescription="Perpetual Product",
                licenseType="perpetual",
                endDate=None,
                totalPoPrice="1000",
            ),
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    parent = next(item for item in converted if item["licenseType"] == "perpetual")
    maintenance = next(item for item in converted if item["licenseType"] == "maintenance")
    assert maintenance["parentLicenseId"] == parent["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == maintenance["id"]
    assert parent_after["maintenanceEndDate"] == "2027-12-31"
    assert parent_after["maintenanceCost"] == "200"


async def test_batch_convert_maintenance_without_clear_parent_returns_400(
    test_app, auth_headers
):
    maintenance_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Standalone Maintenance",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, maintenance_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            _batch_convert_item(
                maintenance_item["id"],
                softwareDescription="Standalone Maintenance",
                licenseType="maintenance",
                endDate="2027-12-31",
            ),
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 400, resp.text
    assert "maintenance licenses require parentLicenseId" in resp.json()["detail"]


async def test_purchase_order_document_is_shared_across_converted_licenses(test_app, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-SHARED-DOC", "supplier": "Shared Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    add_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk",
        json=[
            {
                "publisherName": "Shared Doc Publisher",
                "softwareDescription": "Shared Doc A",
                "quantity": "1",
                "estimatedUnitPrice": "10",
                "estimatedTotalPrice": "10",
                "currency": "EUR",
            },
            {
                "publisherName": "Shared Doc Publisher",
                "softwareDescription": "Shared Doc B",
                "quantity": "1",
                "estimatedUnitPrice": "20",
                "estimatedTotalPrice": "20",
                "currency": "EUR",
            },
        ],
        headers=auth_headers,
    )
    assert add_resp.status_code == 201, add_resp.text

    upload_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/documents",
        files={"file": ("po.pdf", b"purchase order", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    assert upload_resp.json()["category"] == "purchase_order"
    assert f"attachments/procurement/pending_orders/{order_id}/" in upload_resp.json()["filename"].replace("\\", "/")

    order_detail_resp = await test_app.get(f"/api/pending-orders/{order_id}", headers=auth_headers)
    assert order_detail_resp.status_code == 200, order_detail_resp.text
    items = order_detail_resp.json()["items"]
    convert_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert-all",
        json=[
            _batch_convert_item(items[0]["id"], softwareDescription="Shared Doc A", poNumber="PO-SHARED-DOC"),
            _batch_convert_item(items[1]["id"], softwareDescription="Shared Doc B", poNumber="PO-SHARED-DOC"),
        ],
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    converted = [item for item in convert_resp.json() if item["conversionType"] == "new_purchase"]
    assert len(converted) == 2

    for license_row in converted:
        docs_resp = await test_app.get(f"/api/licenses/{license_row['id']}/documents", headers=auth_headers)
        assert docs_resp.status_code == 200, docs_resp.text
        shared_docs = [
            doc for doc in docs_resp.json()
            if doc["category"] == "purchase_order" and doc["scope"] == "po"
        ]
        assert len(shared_docs) == 1
        assert shared_docs[0]["original_filename"] == "po.pdf"


async def test_pending_order_document_download_and_delete(test_app, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-DOC-DIRECT", "supplier": "Document Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    content = b"%PDF-1.4 pending order document"
    upload_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/documents",
        files={"file": ("pending-order.pdf", content, "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    download_resp = await test_app.get(
        f"/api/pending-orders/documents/{document_id}/download",
        headers=auth_headers,
    )
    assert download_resp.status_code == 200
    assert download_resp.content == content
    assert "pending-order.pdf" in download_resp.headers["content-disposition"]

    delete_resp = await test_app.delete(
        f"/api/pending-orders/documents/{document_id}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204
    assert delete_resp.content == b""

    list_resp = await test_app.get(
        f"/api/pending-orders/{order_id}/documents",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


async def test_same_po_number_does_not_share_documents_across_pending_orders(
    test_app, auth_headers, tmp_path, monkeypatch
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    first_order = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-DUP-DOC", "supplier": "First Supplier"},
        headers=auth_headers,
    )
    second_order = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-DUP-DOC", "supplier": "Second Supplier"},
        headers=auth_headers,
    )
    assert first_order.status_code == 201, first_order.text
    assert second_order.status_code == 201, second_order.text
    first_order_id = first_order.json()["id"]
    second_order_id = second_order.json()["id"]

    upload_resp = await test_app.post(
        f"/api/pending-orders/{first_order_id}/documents",
        files={"file": ("first-po.pdf", b"first purchase order", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text

    second_docs = await test_app.get(
        f"/api/pending-orders/{second_order_id}/documents",
        headers=auth_headers,
    )
    assert second_docs.status_code == 200, second_docs.text
    assert second_docs.json() == []

    first_convert = await test_app.post(
        f"/api/pending-orders/{first_order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-DUP-DOC", softwareDescription="First App"))},
        headers=auth_headers,
    )
    second_convert = await test_app.post(
        f"/api/pending-orders/{second_order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-DUP-DOC", softwareDescription="Second App"))},
        headers=auth_headers,
    )
    assert first_convert.status_code == 200, first_convert.text
    assert second_convert.status_code == 200, second_convert.text

    first_license = first_convert.json()[0]
    second_license = second_convert.json()[0]
    first_docs = await test_app.get(f"/api/licenses/{first_license['id']}/documents", headers=auth_headers)
    second_docs = await test_app.get(f"/api/licenses/{second_license['id']}/documents", headers=auth_headers)
    assert first_docs.status_code == 200, first_docs.text
    assert second_docs.status_code == 200, second_docs.text
    assert [doc["original_filename"] for doc in first_docs.json()] == ["first-po.pdf"]
    assert second_docs.json() == []


async def test_invoice_upload_creates_po_scoped_procurement_document(test_app, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-INVOICE-DOC", "supplier": "Invoice Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-INVOICE-DOC"))},
        files={"file": ("invoice.pdf", b"invoice", "application/pdf")},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    license_id = resp.json()[0]["id"]

    docs_resp = await test_app.get(f"/api/licenses/{license_id}/documents", headers=auth_headers)
    assert docs_resp.status_code == 200, docs_resp.text
    invoice_docs = [
        doc for doc in docs_resp.json()
        if doc["category"] == "invoice" and doc["scope"] == "po"
    ]
    assert len(invoice_docs) == 1
    assert invoice_docs[0]["original_filename"] == "invoice.pdf"


async def test_batch_invoice_upload_creates_po_scoped_procurement_document(
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Batch Invoice App",
        estimatedTotalPrice="100",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        data={"data": json.dumps([_batch_convert_item(item["id"], softwareDescription="Batch Invoice App")])},
        files={"file": ("batch-invoice.pdf", b"batch invoice", "application/pdf")},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    license_id = resp.json()[0]["id"]

    docs_resp = await test_app.get(f"/api/licenses/{license_id}/documents", headers=auth_headers)
    assert docs_resp.status_code == 200, docs_resp.text
    invoice_docs = [
        doc for doc in docs_resp.json()
        if doc["category"] == "invoice" and doc["scope"] == "po"
    ]
    assert len(invoice_docs) == 1
    assert invoice_docs[0]["original_filename"] == "batch-invoice.pdf"


async def test_invoice_transfer_failure_records_retryable_state_after_conversion(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    def fail_save(*_args, **_kwargs):
        raise OSError("simulated storage failure")

    monkeypatch.setattr(_storage_module, "save_procurement_document_bytes", fail_save)
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-INVOICE-FAIL", "supplier": "Invoice Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-INVOICE-FAIL"))},
        files={"file": ("invoice.pdf", b"invoice", "application/pdf")},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    license_id = resp.json()[0]["id"]
    assert (await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)).status_code == 200

    db_session.expire_all()
    order = await db_session.get(PendingOrder, order_id)
    assert order.status == "converted"
    assert order.evidence_transfer_status == "failed"
    assert "simulated storage failure" in order.evidence_transfer_detail
    assert order.evidence_transfer_failed_at is not None

    audit_resp = await test_app.get(
        "/api/audit-log?action=po.evidence_transfer_failed",
        headers=auth_headers,
    )
    assert audit_resp.status_code == 200, audit_resp.text
    assert audit_resp.json()["results"][0]["targetId"] == str(order_id)


async def test_quote_transfer_failure_preserves_committed_invoice_evidence(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Invoice Before Quote Failure",
    )
    request_id = sourcing_item["sourcingRequestId"]
    upload_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        files={"file": ("quote.pdf", b"quote", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    async def fail_quote_copy(*_args, **_kwargs):
        raise OSError("simulated quote transfer failure")

    monkeypatch.setattr(
        _conversion_service,
        "copy_quote_documents_to_procurement_documents",
        fail_quote_copy,
    )
    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber=order["poNumber"]))},
        files={"file": ("invoice.pdf", b"durable invoice", "application/pdf")},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    stored_order = await db_session.get(PendingOrder, order["id"])
    assert stored_order.evidence_transfer_status == EvidenceTransferStatus.failed
    invoice_result = await db_session.execute(
        select(ProcurementDocument).where(
            ProcurementDocument.pending_order_id == order["id"],
            ProcurementDocument.category == ProcurementDocumentCategory.invoice,
        )
    )
    invoice = invoice_result.scalar_one()
    assert _storage_module.get_file_path(invoice.filename).read_bytes() == b"durable invoice"


async def test_completion_failure_does_not_delete_committed_evidence_files(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-COMPLETE-FAIL", "supplier": "Invoice Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    async def fail_completion(*_args, **_kwargs):
        raise OSError("simulated completion failure")

    monkeypatch.setattr(_conversion_service, "_mark_evidence_transfer_complete", fail_completion)
    response = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-COMPLETE-FAIL"))},
        files={"file": ("invoice.pdf", b"committed invoice", "application/pdf")},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    stored_order = await db_session.get(PendingOrder, order_id)
    assert stored_order.evidence_transfer_status == EvidenceTransferStatus.failed
    invoice_result = await db_session.execute(
        select(ProcurementDocument).where(
            ProcurementDocument.pending_order_id == order_id,
            ProcurementDocument.category == ProcurementDocumentCategory.invoice,
        )
    )
    invoice = invoice_result.scalar_one()
    assert _storage_module.get_file_path(invoice.filename).read_bytes() == b"committed invoice"


async def test_partial_quote_copy_failure_compensates_quote_rows_and_files_only(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    sourcing_item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Partial Quote Failure",
    )
    request_id = sourcing_item["sourcingRequestId"]
    for filename, content in (("quote-one.pdf", b"quote one"), ("quote-two.pdf", b"quote two")):
        upload_resp = await test_app.post(
            f"/api/sourcing/requests/{request_id}/quote-documents",
            files={"file": (filename, content, "application/pdf")},
            headers=auth_headers,
        )
        assert upload_resp.status_code == 201, upload_resp.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    real_save = _storage_module.save_procurement_document_bytes
    written: dict[str, str] = {}

    def fail_second_quote(content, filename, scope, scope_id, storage_base=None):
        if filename == "quote-two.pdf":
            raise OSError("simulated second quote failure")
        stored_path, file_size = real_save(content, filename, scope, scope_id, storage_base)
        written[filename] = stored_path
        return stored_path, file_size

    monkeypatch.setattr(_storage_module, "save_procurement_document_bytes", fail_second_quote)
    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber=order["poNumber"]))},
        files={"file": ("invoice.pdf", b"invoice survives", "application/pdf")},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    document_result = await db_session.execute(
        select(ProcurementDocument).where(ProcurementDocument.pending_order_id == order["id"])
    )
    documents = document_result.scalars().all()
    assert [document.category for document in documents] == [ProcurementDocumentCategory.invoice]
    assert _storage_module.get_file_path(written["invoice.pdf"]).exists()
    assert not _storage_module.get_file_path(written["quote-one.pdf"]).exists()


async def test_evidence_retry_is_idempotent_when_failed_state_is_replayed(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    sourcing_item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Retry Quote App")
    request_id = sourcing_item["sourcingRequestId"]
    upload_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        files={"file": ("retry-quote.pdf", b"retry quote", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    real_copy = _conversion_service.copy_quote_documents_to_procurement_documents

    async def fail_initial_copy(*_args, **_kwargs):
        raise OSError("simulated initial quote failure")

    monkeypatch.setattr(
        _conversion_service,
        "copy_quote_documents_to_procurement_documents",
        fail_initial_copy,
    )
    conversion = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber=order["poNumber"]))},
        headers=auth_headers,
    )
    assert conversion.status_code == 200, conversion.text
    monkeypatch.setattr(
        _conversion_service,
        "copy_quote_documents_to_procurement_documents",
        real_copy,
    )

    first_retry = await test_app.post(
        f"/api/pending-orders/{order['id']}/retry-evidence-transfer",
        headers=auth_headers,
    )
    assert first_retry.status_code == 204, first_retry.text
    db_session.expire_all()
    stored_order = await db_session.get(PendingOrder, order["id"])
    stored_order.evidence_transfer_status = EvidenceTransferStatus.failed
    await db_session.commit()

    second_retry = await test_app.post(
        f"/api/pending-orders/{order['id']}/retry-evidence-transfer",
        headers=auth_headers,
    )
    assert second_retry.status_code == 204, second_retry.text
    quote_result = await db_session.execute(
        select(ProcurementDocument).where(
            ProcurementDocument.pending_order_id == order["id"],
            ProcurementDocument.category == ProcurementDocumentCategory.quote,
        )
    )
    assert len(quote_result.scalars().all()) == 1


async def test_missing_required_invoice_blocks_manual_and_scheduled_completion(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-MISSING-INVOICE", "supplier": "Invoice Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]
    conversion = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-MISSING-INVOICE"))},
        files={"file": ("invoice.pdf", b"invoice", "application/pdf")},
        headers=auth_headers,
    )
    assert conversion.status_code == 200, conversion.text

    invoice_result = await db_session.execute(
        select(ProcurementDocument).where(
            ProcurementDocument.pending_order_id == order_id,
            ProcurementDocument.category == ProcurementDocumentCategory.invoice,
        )
    )
    invoice = invoice_result.scalar_one()
    _storage_module.delete_file(invoice.filename)
    stored_order = await db_session.get(PendingOrder, order_id)
    stored_order.evidence_transfer_status = EvidenceTransferStatus.failed
    await db_session.commit()

    manual_retry = await test_app.post(
        f"/api/pending-orders/{order_id}/retry-evidence-transfer",
        headers=auth_headers,
    )
    assert manual_retry.status_code == 409, manual_retry.text
    assert "Required invoice evidence is missing" in manual_retry.json()["detail"]

    class SessionContext:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(_conversion_service, "AsyncSessionLocal", SessionContext)
    attempted = await _conversion_service.sweep_stale_evidence_transfers()
    assert attempted == 1
    db_session.expire_all()
    stored_order = await db_session.get(PendingOrder, order_id)
    assert stored_order.evidence_transfer_status == EvidenceTransferStatus.failed
    assert stored_order.evidence_transfer_attempts == 1


async def test_sourcing_quote_carries_forward_as_po_scoped_procurement_document(
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    sourcing_item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Quoted App")
    request_id = sourcing_item["sourcingRequestId"]

    upload_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        files={"file": ("quote.pdf", b"quote", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    assert f"attachments/sourcing_requests/{request_id}/" in upload_resp.json()["filename"].replace("\\", "/")

    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    convert_resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber=po["poNumber"], softwareDescription="Quoted App"))},
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    license_id = convert_resp.json()[0]["id"]

    docs_resp = await test_app.get(f"/api/licenses/{license_id}/documents", headers=auth_headers)
    assert docs_resp.status_code == 200, docs_resp.text
    quote_docs = [
        doc for doc in docs_resp.json()
        if doc["category"] == "quote" and doc["scope"] == "po"
    ]
    assert len(quote_docs) == 1
    assert quote_docs[0]["original_filename"] == "quote.pdf"
    assert f"attachments/procurement/pending_orders/{po['id']}/" in quote_docs[0]["filename"].replace("\\", "/")


async def test_sourcing_quote_document_download_and_delete(test_app, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    sourcing_item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Direct Quote App")
    request_id = sourcing_item["sourcingRequestId"]

    content = b"%PDF-1.4 direct quote"
    upload_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        files={"file": ("direct-quote.pdf", content, "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    download_resp = await test_app.get(
        f"/api/sourcing/quote-documents/{document_id}/download",
        headers=auth_headers,
    )
    assert download_resp.status_code == 200
    assert download_resp.content == content
    assert "direct-quote.pdf" in download_resp.headers["content-disposition"]

    delete_resp = await test_app.delete(
        f"/api/sourcing/quote-documents/{document_id}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204
    assert delete_resp.content == b""

    list_resp = await test_app.get(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


async def test_sourcing_quote_upload_rejects_oversized_content_length(
    test_app,
    auth_headers,
):
    sourcing_item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Large Quote App")
    request_id = sourcing_item["sourcingRequestId"]
    oversized_cl = str((settings.MAX_UPLOAD_SIZE_MB + 1) * 1024 * 1024 + 1)

    resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        content=b"%PDF-1.4 small quote",
        headers={**auth_headers, "content-length": oversized_cl},
    )

    assert resp.status_code == 413


async def test_add_sourcing_request_item_and_convert_request(test_app, auth_headers):
    request_resp = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Request Supplier",
            "items": [
                {
                    "publisherName": "Request Publisher",
                    "softwareDescription": "Request App One",
                    "quantity": "1",
                    "estimatedTotalPrice": "10",
                    "currency": "EUR",
                }
            ],
        },
        headers=auth_headers,
    )
    assert request_resp.status_code == 201, request_resp.text
    request_id = request_resp.json()["id"]

    add_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/items",
        json={
            "publisherName": "Request Publisher",
            "softwareDescription": "Request App Two",
            "quantity": "2",
            "estimatedTotalPrice": "20",
            "currency": "EUR",
        },
        headers=auth_headers,
    )
    assert add_resp.status_code == 201, add_resp.text
    assert [item["softwareDescription"] for item in add_resp.json()["items"]] == [
        "Request App One",
        "Request App Two",
    ]

    convert_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/convert",
        json={"poNumber": "PO-REQUEST-CONVERT", "supplier": "PO Supplier"},
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    body = convert_resp.json()
    assert body["poNumber"] == "PO-REQUEST-CONVERT"
    assert [item["softwareDescription"] for item in body["items"]] == [
        "Request App One",
        "Request App Two",
    ]
    assert all(item["status"] == "converted" for item in body["items"])

    duplicate_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/convert",
        json={"poNumber": "PO-REQUEST-CONVERT-2"},
        headers=auth_headers,
    )
    assert duplicate_resp.status_code == 409


async def test_line_edit_updates_request_supplier_contact_and_preserves_them_on_unrelated_edit(
    test_app,
    auth_headers,
):
    item = await _create_sourcing_item(
        test_app,
        auth_headers,
        supplier=None,
        contactEmail=None,
    )
    request_id = item["sourcingRequestId"]

    update_resp = await test_app.put(
        f"/api/sourcing/{item['id']}",
        json={"supplier": "  Adobe Direct  ", "contactEmail": "buyer@adobe.example"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["supplier"] == "Adobe Direct"
    assert update_resp.json()["contactEmail"] == "buyer@adobe.example"

    quantity_resp = await test_app.put(
        f"/api/sourcing/{item['id']}",
        json={"quantity": "3.75"},
        headers=auth_headers,
    )
    assert quantity_resp.status_code == 200, quantity_resp.text

    reloaded = await test_app.get(f"/api/sourcing/requests/{request_id}", headers=auth_headers)
    assert reloaded.status_code == 200, reloaded.text
    request = reloaded.json()
    assert request["supplier"] == "Adobe Direct"
    assert request["contactEmail"] == "buyer@adobe.example"
    assert request["items"][0]["supplier"] == "Adobe Direct"
    assert request["items"][0]["contactEmail"] == "buyer@adobe.example"
    assert request["items"][0]["quantity"] == "3.75"

    clear_resp = await test_app.put(
        f"/api/sourcing/{item['id']}",
        json={"supplier": None},
        headers=auth_headers,
    )
    assert clear_resp.status_code == 200, clear_resp.text
    cleared = await test_app.get(f"/api/sourcing/requests/{request_id}", headers=auth_headers)
    assert cleared.json()["supplier"] is None
    assert cleared.json()["contactEmail"] is None
    assert cleared.json()["items"][0]["supplier"] is None
    assert cleared.json()["items"][0]["contactEmail"] is None


async def test_multi_line_request_identity_is_mirrored_and_conflicting_add_is_atomic(
    test_app,
    auth_headers,
):
    create_resp = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Common Reseller",
            "contactEmail": "sales@reseller.example",
            "items": [
                {
                    "publisherName": "Microsoft",
                    "softwareDescription": "Microsoft 365",
                    "quantity": "10",
                    "currency": "EUR",
                },
                {
                    "publisherName": "Adobe",
                    "softwareDescription": "Creative Cloud",
                    "quantity": "5",
                    "currency": "EUR",
                },
            ],
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    request = create_resp.json()
    assert {item["supplier"] for item in request["items"]} == {"Common Reseller"}
    assert {item["contactEmail"] for item in request["items"]} == {"sales@reseller.example"}

    change_resp = await test_app.put(
        f"/api/sourcing/{request['items'][0]['id']}",
        json={"supplier": "New Reseller"},
        headers=auth_headers,
    )
    assert change_resp.status_code == 200, change_resp.text
    reloaded = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert reloaded.json()["supplier"] == "New Reseller"
    assert reloaded.json()["contactEmail"] is None
    assert {item["supplier"] for item in reloaded.json()["items"]} == {"New Reseller"}
    assert {item["contactEmail"] for item in reloaded.json()["items"]} == {None}

    conflict_resp = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/items",
        json={
            "publisherName": "Autodesk",
            "softwareDescription": "AutoCAD",
            "quantity": "2",
            "currency": "EUR",
            "supplier": "Conflicting Direct Supplier",
        },
        headers=auth_headers,
    )
    assert conflict_resp.status_code == 409
    after_conflict = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert len(after_conflict.json()["items"]) == 2
    assert {item["supplier"] for item in after_conflict.json()["items"]} == {"New Reseller"}


async def test_request_creation_rejects_conflicting_line_suppliers(test_app, auth_headers):
    response = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Request Supplier",
            "items": [
                {
                    "publisherName": "Publisher A",
                    "softwareDescription": "App A",
                    "currency": "EUR",
                },
                {
                    "publisherName": "Publisher B",
                    "softwareDescription": "App B",
                    "currency": "EUR",
                    "supplier": "Other Supplier",
                },
            ],
        },
        headers=auth_headers,
    )
    assert response.status_code == 422

    active = await test_app.get("/api/sourcing/requests", headers=auth_headers)
    assert active.status_code == 200
    assert active.json() == []


async def test_sourcing_conversion_requires_and_reconciles_one_supplier(test_app, auth_headers):
    unassigned = await _create_sourcing_item(test_app, auth_headers, supplier=None)
    missing_supplier = await test_app.post(
        f"/api/sourcing/requests/{unassigned['sourcingRequestId']}/convert",
        json={"poNumber": "PO-NO-SUPPLIER"},
        headers=auth_headers,
    )
    assert missing_supplier.status_code == 422

    existing_order = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-EXISTING-SUPPLIER", "supplier": "Existing Supplier"},
        headers=auth_headers,
    )
    adopt_resp = await test_app.post(
        f"/api/sourcing/requests/{unassigned['sourcingRequestId']}/convert",
        json={"pendingOrderId": existing_order.json()["id"]},
        headers=auth_headers,
    )
    assert adopt_resp.status_code == 200, adopt_resp.text
    adopted = await test_app.get(
        f"/api/sourcing/requests/{unassigned['sourcingRequestId']}",
        headers=auth_headers,
    )
    assert adopted.json()["supplier"] == "Existing Supplier"
    assert adopted.json()["items"][0]["supplier"] == "Existing Supplier"

    conflicting = await _create_sourcing_item(test_app, auth_headers, supplier="Different Supplier")
    conflict_resp = await test_app.post(
        f"/api/sourcing/requests/{conflicting['sourcingRequestId']}/convert",
        json={"pendingOrderId": existing_order.json()["id"]},
        headers=auth_headers,
    )
    assert conflict_resp.status_code == 409
    still_open = await test_app.get(
        f"/api/sourcing/requests/{conflicting['sourcingRequestId']}",
        headers=auth_headers,
    )
    assert still_open.json()["status"] == "sourcing"
    assert still_open.json()["supplier"] == "Different Supplier"


async def test_pending_order_supplier_is_authoritative_for_resulting_license(test_app, auth_headers):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-AUTHORITATIVE", "supplier": "Actual PO Supplier"},
        headers=auth_headers,
    )
    order_id = order_resp.json()["id"]

    conflict = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    poNumber="PO-AUTHORITATIVE",
                    supplier="Contradictory License Supplier",
                )
            )
        },
        headers=auth_headers,
    )
    assert conflict.status_code == 422

    success = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-AUTHORITATIVE"))},
        headers=auth_headers,
    )
    assert success.status_code == 200, success.text
    created = next(row for row in success.json() if row["conversionType"] == "new_purchase")
    assert created["supplier"] == "Actual PO Supplier"


async def test_renewal_target_supplier_can_change_without_rewriting_historical_supplier(
    test_app,
    auth_headers,
):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Supplier-flexible renewal",
        supplier="Historical Reseller A",
        contactEmail="historical@example.test",
        endDate="2026-12-31",
    )
    renewal_item = await _initiate_renewal(test_app, auth_headers, predecessor["id"])

    choose_direct = await test_app.put(
        f"/api/sourcing/{renewal_item['id']}",
        json={"supplier": "Publisher Direct"},
        headers=auth_headers,
    )
    assert choose_direct.status_code == 200, choose_direct.text
    assert choose_direct.json()["supplier"] == "Publisher Direct"
    assert choose_direct.json()["contactEmail"] is None

    choose_reseller = await test_app.put(
        f"/api/sourcing/{renewal_item['id']}",
        json={"supplier": "Reseller B", "contactEmail": "renewals@reseller-b.example"},
        headers=auth_headers,
    )
    assert choose_reseller.status_code == 200, choose_reseller.text
    request = await test_app.get(
        f"/api/sourcing/requests/{renewal_item['sourcingRequestId']}",
        headers=auth_headers,
    )
    assert request.status_code == 200, request.text
    assert request.json()["supplier"] == "Reseller B"
    assert request.json()["contactEmail"] == "renewals@reseller-b.example"
    assert request.json()["items"][0]["supplier"] == "Reseller B"

    historical = await _get_license(test_app, auth_headers, predecessor["id"])
    assert historical["supplier"] == "Historical Reseller A"
    assert historical["contactEmail"] == "historical@example.test"


async def test_request_editor_can_change_pending_renewal_supplier(
    test_app,
    auth_headers,
    db_session,
):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Request editor supplier renewal",
        supplier="Historical Renewal Supplier",
        contactEmail="historical@example.test",
        endDate=(date.today() + timedelta(days=30)).isoformat(),
    )
    renewal_item = await _initiate_renewal(test_app, auth_headers, predecessor["id"])
    request_id = renewal_item["sourcingRequestId"]

    request_response = await test_app.get(
        f"/api/sourcing/requests/{request_id}",
        headers=auth_headers,
    )
    assert request_response.status_code == 200, request_response.text
    sourcing_request = request_response.json()
    item = sourcing_request["items"][0]

    update_response = await test_app.put(
        f"/api/sourcing/requests/{request_id}",
        json={
            "supplier": "New Request Editor Supplier",
            "contactEmail": "new-renewals@example.test",
            "notes": sourcing_request["notes"],
            "items": [
                {
                    "id": item["id"],
                    "publisherName": item["publisherName"],
                    "softwareDescription": item["softwareDescription"],
                    "licenseType": item["licenseType"],
                    "quantity": item["quantity"],
                    "estimatedUnitPrice": item["estimatedUnitPrice"],
                    "estimatedTotalPrice": item["estimatedTotalPrice"],
                    "currency": item["currency"],
                    "startDate": item["startDate"],
                    "endDate": item["endDate"],
                    "notes": item["notes"],
                }
            ],
        },
        headers=auth_headers,
    )

    assert update_response.status_code == 200, update_response.text
    updated_request = update_response.json()
    assert updated_request["supplier"] == "New Request Editor Supplier"
    assert updated_request["contactEmail"] == "new-renewals@example.test"
    assert updated_request["items"][0]["supplier"] == "New Request Editor Supplier"
    assert updated_request["items"][0]["contactEmail"] == "new-renewals@example.test"

    historical = await _get_license(test_app, auth_headers, predecessor["id"])
    assert historical["supplier"] == "Historical Renewal Supplier"
    assert historical["contactEmail"] == "historical@example.test"

    audit = await db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "sourcing_request.updated",
            AuditLog.target_id == str(request_id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert "mutationType=sourcing_request_edit" in audit.detail
    assert "supplier: Historical Renewal Supplier" in audit.detail
    assert "New Request Editor Supplier" in audit.detail


async def test_renewal_bundle_with_historical_supplier_variation_starts_unassigned(
    test_app,
    auth_headers,
):
    first = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Bundle App A",
        poNumber="PO-HISTORICAL-MIX",
        endDate="2026-12-31",
        supplier="Historical Reseller",
        contactEmail="first@example.test",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Bundle App B",
        poNumber="PO-HISTORICAL-MIX",
        endDate="2026-12-31",
        supplier="Historical Direct",
        contactEmail="second@example.test",
    )

    response = await test_app.post(
        "/api/licenses/renewal-bundle/initiate",
        json={"licenseIds": [first["id"], second["id"]]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    request = response.json()["sourcingRequest"]
    assert request["supplier"] is None
    assert request["contactEmail"] is None
    assert {item["supplier"] for item in request["items"]} == {None}
    assert {item["contactEmail"] for item in request["items"]} == {None}

    select_target = await test_app.put(
        f"/api/sourcing/{request['items'][0]['id']}",
        json={"supplier": "New Common Reseller", "contactEmail": "renewals@example.test"},
        headers=auth_headers,
    )
    assert select_target.status_code == 200, select_target.text
    reloaded = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert reloaded.json()["supplier"] == "New Common Reseller"
    assert {item["supplier"] for item in reloaded.json()["items"]} == {"New Common Reseller"}

    first_after = await _get_license(test_app, auth_headers, first["id"])
    second_after = await _get_license(test_app, auth_headers, second["id"])
    assert first_after["supplier"] == "Historical Reseller"
    assert second_after["supplier"] == "Historical Direct"


async def test_coterm_merge_with_conflicting_request_suppliers_starts_unassigned(
    test_app,
    auth_headers,
):
    first = await _create_license(
        test_app,
        auth_headers,
        supplier="Historical A",
        startDate="2024-01-01",
        endDate="2025-12-31",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        supplier="Historical B",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    first_item = await _initiate_renewal(test_app, auth_headers, first["id"])
    second_item = await _initiate_renewal(test_app, auth_headers, second["id"])

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [first_item["id"], second_item["id"]]},
        headers=auth_headers,
    )
    assert merge_resp.status_code == 201, merge_resp.text
    merged = merge_resp.json()
    assert merged["supplier"] is None
    assert merged["contactEmail"] is None
    request = await test_app.get(
        f"/api/sourcing/requests/{merged['sourcingRequestId']}",
        headers=auth_headers,
    )
    assert request.json()["supplier"] is None


async def test_batch_convert_all_preserves_saas_portal_url(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Batch SaaS App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            _batch_convert_item(
                item["id"],
                softwareDescription="Batch SaaS App",
                licenseType="saas",
                portalUrl="https://batch.example.com",
            )
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert converted[0]["licenseType"] == "saas"
    assert converted[0]["portalUrl"] == "https://batch.example.com"


async def test_batch_partial_conversion_is_rejected_before_any_write(test_app, auth_headers, db_session):
    first = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Partial App One")
    second = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Partial App Two")
    po = await _convert_sourcing_to_po(test_app, auth_headers, first["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, second["id"], po["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(first["id"], softwareDescription="Partial App One")],
        headers=auth_headers,
    )

    assert resp.status_code == 400, resp.text
    assert "Missing convertible sourcing item IDs" in resp.json()["detail"]
    created_result = await db_session.execute(
        select(License).where(License.source_sourcing_item_id.in_([first["id"], second["id"]]))
    )
    assert created_result.scalars().all() == []
    db_session.expire_all()
    stored_order = await db_session.get(PendingOrder, po["id"])
    assert stored_order.status != PendingOrderStatus.converted


async def test_batch_duplicate_item_ids_are_rejected_before_any_write(test_app, auth_headers, db_session):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Duplicate Batch App")
    order = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])
    payload = _batch_convert_item(item["id"], softwareDescription="Duplicate Batch App")

    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[payload, payload],
        headers=auth_headers,
    )

    assert response.status_code == 400, response.text
    assert "Duplicate sourcing item IDs" in response.json()["detail"]
    created_result = await db_session.execute(
        select(License).where(License.source_sourcing_item_id == item["id"])
    )
    assert created_result.scalars().all() == []


async def test_batch_foreign_order_item_is_rejected_before_any_write(test_app, auth_headers, db_session):
    first = await _create_sourcing_item(test_app, auth_headers, softwareDescription="First Order App")
    second = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Second Order App")
    first_order = await _convert_sourcing_to_po(test_app, auth_headers, first["id"])
    await _convert_sourcing_to_po(test_app, auth_headers, second["id"])

    response = await test_app.post(
        f"/api/pending-orders/{first_order['id']}/convert-all",
        json=[_batch_convert_item(second["id"], softwareDescription="Second Order App")],
        headers=auth_headers,
    )

    assert response.status_code == 400, response.text
    assert "Items not found in pending order" in response.json()["detail"]
    created_result = await db_session.execute(
        select(License).where(License.source_sourcing_item_id.in_([first["id"], second["id"]]))
    )
    assert created_result.scalars().all() == []


async def test_batch_rejects_sourcing_item_consumed_by_retired_license(
    test_app,
    auth_headers,
    db_session,
):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Consumed Batch App")
    order = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])
    previous = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Retired Converted App",
    )
    previous_license = await db_session.get(License, previous["id"])
    previous_license.source_sourcing_item_id = item["id"]
    previous_license.is_retired = True
    await db_session.commit()

    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[_batch_convert_item(item["id"], softwareDescription="Consumed Batch App")],
        headers=auth_headers,
    )

    assert response.status_code == 409, response.text
    assert "already converted or ineligible" in response.json()["detail"]
    converted_result = await db_session.execute(
        select(License).where(License.source_sourcing_item_id == item["id"])
    )
    assert [license_obj.id for license_obj in converted_result.scalars().all()] == [previous["id"]]


async def test_pending_order_line_item_can_be_edited_before_conversion(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Needs Edit")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    resp = await test_app.put(
        f"/api/pending-orders/{po['id']}/items/{item['id']}",
        json={
            "publisherName": "Edited Publisher",
            "softwareDescription": "Edited App",
            "quantity": "7",
            "estimatedUnitPrice": "30",
            "estimatedTotalPrice": "210",
            "currency": "EUR",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    updated_item = resp.json()["items"][0]
    assert updated_item["publisherName"] == "Edited Publisher"
    assert updated_item["softwareDescription"] == "Edited App"
    assert updated_item["quantity"] == "7"
    assert updated_item["estimatedTotalPrice"] == "210"


async def test_pending_order_line_item_preserves_start_and_end_dates(test_app, auth_headers):
    """A sourcing item's start/end dates must survive conversion to a pending order.

    Regression: SourcingItemSummary (nested in PendingOrderResponse) previously
    omitted start_date/end_date, so the PO view showed the dates as blank.
    """
    item = await _create_sourcing_item(
        test_app,
        auth_headers,
        softwareDescription="Dated App",
        startDate="2026-03-01",
        endDate="2027-02-28",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    # Dates present on the convert response...
    convert_line = po["items"][0]
    assert convert_line["startDate"] == "2026-03-01"
    assert convert_line["endDate"] == "2027-02-28"

    # ...and on a subsequent GET of the pending order.
    resp = await test_app.get(f"/api/pending-orders/{po['id']}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    line = resp.json()["items"][0]
    assert line["startDate"] == "2026-03-01"
    assert line["endDate"] == "2027-02-28"


async def test_pending_order_line_item_includes_sourcing_quote_documents(
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Quoted Pending App")
    request_id = item["sourcingRequestId"]

    upload_resp = await test_app.post(
        f"/api/sourcing/requests/{request_id}/quote-documents",
        files={"file": ("pending-quote.pdf", b"quote", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    quote_document_id = upload_resp.json()["id"]

    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    convert_line = po["items"][0]
    assert convert_line["quoteDocuments"][0]["id"] == quote_document_id
    assert convert_line["quoteDocuments"][0]["originalFilename"] == "pending-quote.pdf"

    resp = await test_app.get("/api/pending-orders", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    order = next(order for order in resp.json() if order["id"] == po["id"])
    line = order["items"][0]
    assert line["quoteDocuments"][0]["id"] == quote_document_id
    assert line["quoteDocuments"][0]["originalFilename"] == "pending-quote.pdf"
    assert line["quoteDocuments"][0]["fileAvailability"] == "available"


async def test_pending_order_line_item_can_be_deleted_before_conversion(test_app, auth_headers):
    first = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Keep App")
    second = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Delete App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, first["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, second["id"], po["id"])

    resp = await test_app.delete(
        f"/api/pending-orders/{po['id']}/items/{second['id']}",
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    remaining = resp.json()["items"]
    assert len(remaining) == 1
    assert remaining[0]["id"] == first["id"]


async def test_deleting_last_pending_order_line_cancels_order(test_app, auth_headers, db_session):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Only App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    resp = await test_app.delete(
        f"/api/pending-orders/{po['id']}/items/{item['id']}",
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["items"] == []

    db_session.expire_all()
    order = await db_session.get(PendingOrder, po["id"])
    assert order.status == PendingOrderStatus.cancelled

    active_resp = await test_app.get("/api/pending-orders", headers=auth_headers)
    assert active_resp.status_code == 200, active_resp.text
    assert all(order["id"] != po["id"] for order in active_resp.json())

    history_resp = await test_app.get("/api/pending-orders/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history_order = next(order for order in history_resp.json() if order["id"] == po["id"])
    assert history_order["status"] == "cancelled"
    assert history_order["items"] == []

    audit_resp = await test_app.get("/api/audit-log?action=po.cancelled", headers=auth_headers)
    assert audit_resp.status_code == 200, audit_resp.text
    assert any(row["targetId"] == str(po["id"]) and row["detail"] == "last line deleted" for row in audit_resp.json()["results"])


async def test_pending_order_can_be_deleted_with_empty_204(test_app, auth_headers):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-DELETE", "supplier": "Delete Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    delete_resp = await test_app.delete(
        f"/api/pending-orders/{order_id}",
        headers=auth_headers,
    )

    assert delete_resp.status_code == 204
    assert delete_resp.content == b""
    get_resp = await test_app.get(f"/api/pending-orders/{order_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_pending_order_line_item_edit_rejected_after_conversion(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Locked App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])
    convert_resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(item["id"], softwareDescription="Locked App")],
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text

    resp = await test_app.put(
        f"/api/pending-orders/{po['id']}/items/{item['id']}",
        json={"quantity": "99"},
        headers=auth_headers,
    )

    assert resp.status_code == 409


async def test_pending_order_conversion_error_cases(test_app, auth_headers):
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={"poNumber": "PO-ERROR", "supplier": "Error Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    invalid_json = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": "{not-json"},
        headers=auth_headers,
    )
    missing_item = await test_app.post(
        f"/api/pending-orders/{order_id}/convert-all",
        json=[_batch_convert_item(999999)],
        headers=auth_headers,
    )
    empty_payload = await test_app.post(
        f"/api/pending-orders/{order_id}/convert-all",
        json=[],
        headers=auth_headers,
    )

    assert invalid_json.status_code == 422
    assert missing_item.status_code == 400
    assert empty_payload.status_code == 200


async def test_single_saas_renewal_persists_confirmed_conversion_values(test_app, auth_headers):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        publisherName="Predecessor Publisher",
        softwareDescription="Predecessor SaaS",
        licenseType="saas",
        licenseMetric="enterprise",
        quantity="41",
        unitPrice="410",
        totalPoPrice="16810",
        currency="EUR",
        startDate="2025-01-01",
        endDate="2025-12-31",
        contractNumber="PREDECESSOR-CONTRACT",
        skuCode="PREDECESSOR-SKU",
        contactEmail="predecessor@example.test",
        supplier="Predecessor Supplier",
        costCentre="PREDECESSOR-COST",
        budgetOwnerEmail="predecessor-budget@example.test",
        portalUrl="https://predecessor.example.test",
        notes="Predecessor notes",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, predecessor["id"])
    line_update = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={
            "publisherName": "Stale Line Publisher",
            "softwareDescription": "Stale Line SaaS",
            "quantity": "51",
            "estimatedUnitPrice": "510",
            "estimatedTotalPrice": "26010",
            "currency": "USD",
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "supplier": "Stale Line Supplier",
            "contactEmail": "stale-line@example.test",
            "notes": "Stale line notes",
        },
        headers=auth_headers,
    )
    assert line_update.status_code == 200, line_update.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    order_update = await test_app.put(
        f"/api/pending-orders/{order['id']}",
        json={"supplier": "Confirmed Supplier", "notes": "Stale order notes"},
        headers=auth_headers,
    )
    assert order_update.status_code == 200, order_update.text

    expected = {
        "publisherName": "Confirmed Publisher",
        "softwareDescription": "Confirmed SaaS",
        "licenseType": "subscription",
        "licenseMetric": "concurrent",
        "quantity": "61",
        "skuCode": "CONFIRMED-SKU",
        "unitPrice": "610.25",
        "totalPoPrice": "37225.25",
        "currency": "GBP",
        "startDate": "2027-02-03",
        "endDate": "2028-02-02",
        "contractNumber": "",
        "poNumber": "PO-CONFIRMED",
        "invoiceNumber": "INV-CONFIRMED",
        "contactEmail": "confirmed@example.test",
        "supplier": "Confirmed Supplier",
        "costCentre": "CONFIRMED-COST",
        "budgetOwnerEmail": "confirmed-budget@example.test",
        "portalUrl": None,
        "notes": "Confirmed final notes",
    }
    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={"data": json.dumps(expected)},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), predecessor["id"])
    _assert_license_fields(successor, expected)
    assert successor["renewedFromId"] == predecessor["id"]
    assert successor["predecessorId"] == predecessor["id"]
    assert successor["licenseRef"] == predecessor["licenseRef"]

    stored = await _get_license(test_app, auth_headers, successor["id"])
    _assert_license_fields(stored, expected)
    assert stored["renewedFromId"] == predecessor["id"]


async def test_single_saas_renewal_uses_line_and_predecessor_fallbacks_when_omitted(
    test_app,
    auth_headers,
):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        publisherName="Fallback Publisher",
        softwareDescription="Fallback SaaS",
        licenseType="saas",
        licenseMetric="enterprise",
        quantity="71",
        skuCode="FALLBACK-SKU",
        unitPrice="710",
        totalPoPrice="50410",
        currency="EUR",
        startDate="2025-01-01",
        endDate="2025-12-31",
        contractNumber="FALLBACK-CONTRACT",
        contactEmail="predecessor-fallback@example.test",
        supplier="Predecessor Fallback Supplier",
        costCentre="FALLBACK-COST",
        budgetOwnerEmail="fallback-budget@example.test",
        portalUrl="https://fallback.example.test",
        notes="Previous fallback note",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, predecessor["id"])
    line_update = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={
            "quantity": "72",
            "estimatedUnitPrice": "720.50",
            "estimatedTotalPrice": "51876",
            "currency": "USD",
            "startDate": "2027-03-04",
            "endDate": "2028-03-03",
            "supplier": "Current Line Supplier",
            "contactEmail": "current-line@example.test",
            "notes": "Current line note",
        },
        headers=auth_headers,
    )
    assert line_update.status_code == 200, line_update.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    order_update = await test_app.put(
        f"/api/pending-orders/{order['id']}",
        json={"notes": "Current PO note"},
        headers=auth_headers,
    )
    assert order_update.status_code == 200, order_update.text

    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={
            "data": json.dumps(
                {
                    "publisherName": "Submitted Required Publisher",
                    "softwareDescription": "Submitted Required SaaS",
                }
            )
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), predecessor["id"])
    expected = {
        "publisherName": "Submitted Required Publisher",
        "softwareDescription": "Submitted Required SaaS",
        "licenseType": "saas",
        "licenseMetric": "enterprise",
        "quantity": "72",
        "skuCode": "FALLBACK-SKU",
        "unitPrice": "720.50",
        "totalPoPrice": "51876",
        "currency": "USD",
        "startDate": "2027-03-04",
        "endDate": "2028-03-03",
        "contractNumber": "FALLBACK-CONTRACT",
        "contactEmail": "",
        "supplier": "Renewal Supplier",
        "costCentre": "FALLBACK-COST",
        "budgetOwnerEmail": "fallback-budget@example.test",
        "portalUrl": "https://fallback.example.test",
        "notes": (
            "Purchase order notes:\nCurrent PO note\n\n"
            "Line item notes:\nCurrent line note\n\n"
            "Previous license notes:\nPrevious fallback note"
        ),
    }
    _assert_license_fields(successor, expected)
    stored = await _get_license(test_app, auth_headers, successor["id"])
    _assert_license_fields(stored, expected)


async def test_batch_subscription_renewal_persists_confirmed_conversion_values(
    test_app,
    auth_headers,
):
    predecessor = await _create_license(
        test_app,
        auth_headers,
        publisherName="Batch Predecessor Publisher",
        softwareDescription="Batch Predecessor App",
        licenseType="subscription",
        licenseMetric="per_device",
        quantity="81",
        unitPrice="810",
        totalPoPrice="65610",
        currency="EUR",
        startDate="2025-01-01",
        endDate="2025-12-31",
        notes="Batch predecessor notes",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, predecessor["id"])
    line_update = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={
            "quantity": "82",
            "estimatedUnitPrice": "820",
            "estimatedTotalPrice": "67240",
            "currency": "USD",
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "supplier": "Stale Batch Line Supplier",
            "contactEmail": "stale-batch@example.test",
            "notes": "Stale batch line notes",
        },
        headers=auth_headers,
    )
    assert line_update.status_code == 200, line_update.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    submitted = _batch_convert_item(
        sourcing_item["id"],
        publisherName="Confirmed Batch Publisher",
        softwareDescription="Confirmed Batch App",
        licenseType="subscription",
        licenseMetric="site",
        quantity="83",
        unitPrice="830.75",
        totalPoPrice="68952.25",
        currency="GBP",
        startDate="2027-04-05",
        endDate="2028-04-04",
        supplier="Renewal Supplier",
        contactEmail="confirmed-batch@example.test",
        notes="Confirmed batch notes",
    )
    response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[submitted],
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), predecessor["id"])
    expected = {
        field: value
        for field, value in submitted.items()
        if field not in {"sourcingItemId", "purchaseDate"}
    }
    _assert_license_fields(successor, expected)
    assert successor["renewedFromId"] == predecessor["id"]
    assert successor["licenseRef"] == predecessor["licenseRef"]
    stored = await _get_license(test_app, auth_headers, successor["id"])
    _assert_license_fields(stored, expected)


async def test_convert_po_with_maintenance_renewal_succeeds(db_session, test_app, auth_headers):
    parent, maintenance = await _create_parent_with_maintenance(test_app, auth_headers)
    parent_before = await _get_license(test_app, auth_headers, parent["id"])
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    update_resp = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={
            "quantity": "1",
            "estimatedUnitPrice": "3400",
            "estimatedTotalPrice": "3400",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    licenseType="subscription",
                    licenseMetric="site",
                    quantity="2",
                    unitPrice="1800.50",
                    totalPoPrice="3601.00",
                    currency="USD",
                    startDate="2027-05-06",
                    endDate="2028-05-05",
                    supplier="Renewal Supplier",
                    contactEmail="confirmed-maintenance@example.test",
                    notes="Confirmed maintenance notes",
                )
            )
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), maintenance["id"])
    assert new_license["licenseType"] == "maintenance"
    assert new_license["licenseMetric"] == maintenance["licenseMetric"]
    assert new_license["parentLicenseId"] == parent["id"]
    assert new_license["isLegacyUnlinkedMaintenance"] is False
    successor_detail = await _get_license(test_app, auth_headers, new_license["id"])
    assert successor_detail["maintenanceParentIds"] == [parent["id"]]
    assert new_license["renewedFromId"] == maintenance["id"]
    _assert_license_fields(
        new_license,
        {
            "quantity": "2",
            "unitPrice": "1800.50",
            "totalPoPrice": "3601.00",
            "currency": "USD",
            "startDate": "2027-05-06",
            "endDate": "2028-05-05",
            "supplier": "Renewal Supplier",
            "contactEmail": "confirmed-maintenance@example.test",
            "notes": "Confirmed maintenance notes",
        },
    )
    stored = await _get_license(test_app, auth_headers, new_license["id"])
    _assert_license_fields(
        stored,
        {
            "quantity": "2",
            "unitPrice": "1800.50",
            "totalPoPrice": "3601.00",
            "currency": "USD",
            "startDate": "2027-05-06",
            "endDate": "2028-05-05",
            "supplier": "Renewal Supplier",
            "contactEmail": "confirmed-maintenance@example.test",
            "notes": "Confirmed maintenance notes",
        },
    )

    old_maintenance = await _get_license(test_app, auth_headers, maintenance["id"])
    assert old_maintenance["lifecycleStatus"] == "renewed"
    assert old_maintenance["renewedToId"] == new_license["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == new_license["id"]
    assert new_license["id"] in parent_after["linkedMaintenanceIds"]
    successor_link = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == new_license["id"],
            LicenseMaintenanceLink.parent_license_id == parent["id"],
        )
    )
    assert successor_link.scalar_one_or_none() is not None
    assert parent_after["maintenanceEndDate"] == new_license["endDate"]
    assert parent_after["maintenanceCost"] == "3601.00"
    assert new_license["totalPoPrice"] == "3601.00"
    assert parent_after["lifecycleStatus"] == parent_before["lifecycleStatus"]


async def test_batch_convert_with_maintenance_renewal_succeeds(db_session, test_app, auth_headers):
    parent, maintenance = await _create_parent_with_maintenance(test_app, auth_headers)
    parent_before = await _get_license(test_app, auth_headers, parent["id"])
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            {
                "sourcingItemId": sourcing_item["id"],
                "publisherName": "Batch Publisher",
                "softwareDescription": "Batch Maintenance Renewal",
                "quantity": "10",
                "unitPrice": "470",
                "totalPoPrice": "4700",
                "currency": "EUR",
                "startDate": "2026-01-01",
                "endDate": "2026-12-31",
                "poNumber": "PO-BATCH",
                "supplier": "Renewal Supplier",
            }
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), maintenance["id"])
    assert new_license["licenseType"] == "maintenance"
    assert new_license["parentLicenseId"] == parent["id"]
    assert new_license["isLegacyUnlinkedMaintenance"] is False
    successor_detail = await _get_license(test_app, auth_headers, new_license["id"])
    assert successor_detail["maintenanceParentIds"] == [parent["id"]]
    assert new_license["renewedFromId"] == maintenance["id"]
    assert new_license["totalPoPrice"] == "4700"

    old_maintenance = await _get_license(test_app, auth_headers, maintenance["id"])
    assert old_maintenance["lifecycleStatus"] == "renewed"
    assert old_maintenance["renewedToId"] == new_license["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == new_license["id"]
    assert new_license["id"] in parent_after["linkedMaintenanceIds"]
    successor_link = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == new_license["id"],
            LicenseMaintenanceLink.parent_license_id == parent["id"],
        )
    )
    assert successor_link.scalar_one_or_none() is not None
    assert parent_after["maintenanceEndDate"] == new_license["endDate"]
    assert parent_after["maintenanceCost"] == "4700"
    assert parent_after["lifecycleStatus"] == parent_before["lifecycleStatus"]


async def test_convert_subscription_renewal_unaffected(test_app, auth_headers):
    subscription = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
        maintenanceCoverage="included",
        maintenanceStartDate="2025-01-01",
        maintenanceEndDate="2025-12-31",
        unitPrice="100",
        totalPoPrice="1000",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    assert sourcing_item["maintenanceCoverage"] == "included"

    update = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={"quantity": "20"},
        headers=auth_headers,
    )
    assert update.status_code == 200, update.text
    assert update.json()["maintenanceCoverage"] == "included"

    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    pending = await test_app.get(f"/api/pending-orders/{po['id']}", headers=auth_headers)
    assert pending.status_code == 200, pending.text
    assert pending.json()["items"][0]["maintenanceCoverage"] == "included"

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(
            maintenanceCoverage="included",
            quantity="20",
            unitPrice="100",
            totalPoPrice="2000",
            startDate="2026-04-01",
            endDate="2027-03-31",
        ))},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), subscription["id"])
    assert new_license["licenseType"] == "subscription"
    assert new_license["parentLicenseId"] is None
    assert new_license["renewedFromId"] == subscription["id"]
    assert new_license["predecessorId"] == subscription["id"]
    assert new_license["maintenanceCoverage"] == "included"
    assert new_license["startDate"] == "2026-04-01"
    assert new_license["endDate"] == "2027-03-31"
    assert new_license["maintenanceStartDate"] == "2026-04-01"
    assert new_license["maintenanceEndDate"] == "2027-03-31"
    assert new_license["maintenanceCost"] == "2000"
    assert new_license["maintenanceParentIds"] == []

    predecessor = await _get_license(test_app, auth_headers, subscription["id"])
    assert predecessor["lifecycleStatus"] == "renewed"
    assert predecessor["renewedToId"] == new_license["id"]
    assert predecessor["maintenanceCoverage"] == "included"
    assert predecessor["maintenanceStartDate"] == "2025-01-01"
    assert predecessor["maintenanceEndDate"] == "2025-12-31"


async def test_coterm_successor_can_be_renewed_as_next_generation(test_app, auth_headers):
    first = await _create_license(
        test_app,
        auth_headers,
        startDate="2024-01-01",
        endDate="2025-12-31",
    )
    second = await _create_license(
        test_app,
        auth_headers,
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_first = await _initiate_renewal(test_app, auth_headers, first["id"])
    sourcing_second = await _initiate_renewal(test_app, auth_headers, second["id"])

    merge_response = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_second["id"], sourcing_first["id"]]},
        headers=auth_headers,
    )
    assert merge_response.status_code == 201, merge_response.text
    order = await _convert_sourcing_to_po(test_app, auth_headers, merge_response.json()["id"])
    conversion_response = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    publisherName="Confirmed Coterm Publisher",
                    softwareDescription="Confirmed Coterm App",
                    quantity="91",
                    unitPrice="910.25",
                    totalPoPrice="82832.75",
                    currency="GBP",
                    startDate="2026-01-01",
                    endDate="2026-12-31",
                    supplier="Renewal Supplier",
                    contactEmail="confirmed-coterm@example.test",
                    notes="Confirmed coterm notes",
                )
            )
        },
        headers=auth_headers,
    )
    assert conversion_response.status_code == 200, conversion_response.text
    coterm_successor = _new_successor(conversion_response.json(), first["id"])

    next_successor = await _complete_single_renewal(
        test_app,
        auth_headers,
        coterm_successor["id"],
        startDate="2027-01-01",
        endDate="2027-12-31",
    )

    first_after = await _get_license(test_app, auth_headers, first["id"])
    second_after = await _get_license(test_app, auth_headers, second["id"])
    coterm_after = await _get_license(test_app, auth_headers, coterm_successor["id"])
    assert first_after["renewedToId"] == coterm_successor["id"]
    assert second_after["renewedToId"] == coterm_successor["id"]
    assert coterm_after["renewedFromId"] == first["id"]
    assert coterm_after["predecessorId"] == first["id"]
    assert coterm_after["cotermFromIds"] == [first["id"], second["id"]]
    assert coterm_after["renewedToId"] == next_successor["id"]
    _assert_license_fields(
        coterm_after,
        {
            "publisherName": "Confirmed Coterm Publisher",
            "softwareDescription": "Confirmed Coterm App",
            "quantity": "91",
            "unitPrice": "910.25",
            "totalPoPrice": "82832.75",
            "currency": "GBP",
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "supplier": "Renewal Supplier",
            "contactEmail": "confirmed-coterm@example.test",
            "notes": "Confirmed coterm notes",
        },
    )
    assert next_successor["renewedFromId"] == coterm_successor["id"]


async def test_renewed_license_cannot_start_second_renewal(test_app, auth_headers):
    subscription = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    convert_resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )
    assert convert_resp.status_code == 200, convert_resp.text
    successor = _new_successor(convert_resp.json(), subscription["id"])

    resp = await test_app.post(
        f"/api/licenses/{subscription['id']}/initiate-renewal",
        headers=auth_headers,
    )

    assert resp.status_code == 409
    predecessor = await _get_license(test_app, auth_headers, subscription["id"])
    assert predecessor["renewedToId"] == successor["id"]


async def test_convert_stale_renewal_order_does_not_overwrite_existing_successor(
    db_session,
    test_app,
    auth_headers,
):
    subscription = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    existing_successor = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        startDate="2026-01-01",
        endDate="2026-12-31",
    )

    predecessor = await db_session.get(License, subscription["id"])
    successor = await db_session.get(License, existing_successor["id"])
    predecessor.lifecycle_status = "renewed"
    predecessor.renewed_to_id = successor.id
    successor.renewed_from_id = predecessor.id
    await db_session.commit()

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 409
    await db_session.rollback()
    predecessor = await db_session.get(License, subscription["id"])
    successors = (
        await db_session.execute(
            select(License).where(License.renewed_from_id == subscription["id"])
        )
    ).scalars().all()
    assert predecessor.renewed_to_id == existing_successor["id"]
    assert [license_obj.id for license_obj in successors] == [existing_successor["id"]]


async def test_convert_stale_coterm_order_rejects_conflicting_secondary_predecessor(
    db_session,
    test_app,
    auth_headers,
):
    first = await _create_license(test_app, auth_headers, endDate="2025-12-31")
    second = await _create_license(test_app, auth_headers, endDate="2025-12-31")
    sourcing_first = await _initiate_renewal(test_app, auth_headers, first["id"])
    sourcing_second = await _initiate_renewal(test_app, auth_headers, second["id"])
    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_first["id"], sourcing_second["id"]]},
        headers=auth_headers,
    )
    assert merge_resp.status_code == 201, merge_resp.text
    po = await _convert_sourcing_to_po(test_app, auth_headers, merge_resp.json()["id"])
    existing_successor = await _create_license(test_app, auth_headers, endDate="2026-12-31")

    secondary = await db_session.get(License, second["id"])
    successor = await db_session.get(License, existing_successor["id"])
    secondary.lifecycle_status = "renewed"
    secondary.renewed_to_id = successor.id
    successor.renewed_from_id = secondary.id
    await db_session.commit()

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 409
    await db_session.rollback()
    primary = await db_session.get(License, first["id"])
    secondary = await db_session.get(License, second["id"])
    assert primary.renewed_to_id is None
    assert secondary.renewed_to_id == existing_successor["id"]


async def test_coterm_renewal_of_maintenance_updates_parent_active_maintenance(
    db_session,
    test_app,
    auth_headers,
):
    # Perpetual parent with two maintenance children. A has an older start_date
    # so it becomes the primary predecessor when the sourcing items are merged.
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        softwareDescription="Acme Server",
        startDate="2020-01-01",
        endDate=None,
        totalPoPrice="12000",
    )
    maintenance_a = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        softwareDescription="Acme Server Maintenance",
        parentLicenseId=parent["id"],
        quantity="1",
        startDate="2024-01-01",
        endDate="2024-12-31",
        unitPrice="2000",
        totalPoPrice="2000",
    )
    maintenance_b = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        softwareDescription="Acme Server Maintenance",
        parentLicenseId=parent["id"],
        quantity="1",
        startDate="2025-01-01",
        endDate="2025-12-31",
        unitPrice="2200",
        totalPoPrice="2200",
    )
    parent_before = await _get_license(test_app, auth_headers, parent["id"])

    sourcing_a = await _initiate_renewal(test_app, auth_headers, maintenance_a["id"])
    sourcing_b = await _initiate_renewal(test_app, auth_headers, maintenance_b["id"])

    merge_resp = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [sourcing_a["id"], sourcing_b["id"]]},
        headers=auth_headers,
    )
    assert merge_resp.status_code == 201, merge_resp.text
    coterm_item = merge_resp.json()

    update_resp = await test_app.put(
        f"/api/sourcing/{coterm_item['id']}",
        json={
            "quantity": "1",
            "estimatedUnitPrice": "2500",
            "estimatedTotalPrice": "2500",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200, update_resp.text

    po = await _convert_sourcing_to_po(test_app, auth_headers, coterm_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(
            startDate="2026-01-01",
            endDate="2026-12-31",
            unitPrice="2500",
            totalPoPrice="2500",
        ))},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    successor = _new_successor(resp.json(), maintenance_a["id"])
    assert successor["licenseType"] == "maintenance"
    assert successor["parentLicenseId"] == parent["id"]
    assert successor["isLegacyUnlinkedMaintenance"] is False
    successor_detail = await _get_license(test_app, auth_headers, successor["id"])
    assert successor_detail["maintenanceParentIds"] == [parent["id"]]
    assert successor["renewedFromId"] == maintenance_a["id"]

    old_a = await _get_license(test_app, auth_headers, maintenance_a["id"])
    old_b = await _get_license(test_app, auth_headers, maintenance_b["id"])
    assert old_a["lifecycleStatus"] == "renewed"
    assert old_b["lifecycleStatus"] == "renewed"

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == successor["id"]
    assert successor["id"] in parent_after["linkedMaintenanceIds"]
    successor_link = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == successor["id"],
            LicenseMaintenanceLink.parent_license_id == parent["id"],
        )
    )
    assert successor_link.scalar_one_or_none() is not None
    assert parent_after["maintenanceEndDate"] == successor["endDate"]
    assert parent_after["maintenanceCost"] == "2500"
    assert successor["totalPoPrice"] == "2500"
    assert parent_after["lifecycleStatus"] == parent_before["lifecycleStatus"]


async def test_coterm_legacy_unlinked_primary_stays_parentless(
    db_session,
    test_app,
    auth_headers,
):
    primary = await _seed_legacy_unlinked_maintenance(db_session)
    primary.license_ref = "LT-LEGACY-PRIMARY"
    await db_session.commit()
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    secondary = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        publisherName="Legacy Publisher",
        softwareDescription="Legacy Renewal Maintenance",
        startDate="2027-01-01",
        endDate="2027-12-31",
    )
    primary_sourcing = await _initiate_renewal(test_app, auth_headers, primary.id)
    secondary_sourcing = await _initiate_renewal(test_app, auth_headers, secondary["id"])
    merge_response = await test_app.post(
        "/api/sourcing/merge",
        json={"sourcingItemIds": [primary_sourcing["id"], secondary_sourcing["id"]]},
        headers=auth_headers,
    )
    assert merge_response.status_code == 201, merge_response.text
    po = await _convert_sourcing_to_po(test_app, auth_headers, merge_response.json()["id"])

    response = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    startDate="2028-01-01",
                    endDate="2028-12-31",
                )
            )
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), primary.id)
    assert successor["licenseType"] == "maintenance"
    assert successor["parentLicenseId"] is None
    assert successor["isLegacyUnlinkedMaintenance"] is True
    assert successor["licenseRef"] == primary.license_ref
    assert successor["renewedFromId"] == primary.id
    assert successor["cotermFromIds"] == [primary.id, secondary["id"]]

    successor_links = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == successor["id"]
        )
    )
    assert successor_links.scalars().all() == []
    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == secondary["id"]


async def test_batch_convert_maintenance_renewal_with_retired_parent_raises(
    db_session,
    test_app,
    auth_headers,
):
    parent, maintenance = await _create_parent_with_maintenance(test_app, auth_headers)
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    # Retire the parent directly — simulates parent becoming ineligible after sourcing began
    result = await db_session.execute(
        select(License).where(License.id == parent["id"])
    )
    parent_obj = result.scalar_one()
    parent_obj.is_retired = True
    await db_session.commit()

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(sourcing_item["id"])],
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "retired" in resp.json()["detail"]


async def test_convert_maintenance_renewal_with_missing_parent_raises(
    db_session,
    test_app,
    auth_headers,
):
    parent, maintenance = await _create_parent_with_maintenance(test_app, auth_headers)
    # Bypass FK enforcement to simulate a dangling parent_license_id reference.
    await db_session.execute(text("PRAGMA foreign_keys=OFF"))
    await db_session.execute(
        text("UPDATE licenses SET parent_license_id=999999 WHERE id=:id"),
        {"id": maintenance["id"]},
    )
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    db_session.expire_all()

    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 400, resp.text
    assert "does not exist" in resp.json()["detail"]

    maintenance_after = await _get_license(test_app, auth_headers, maintenance["id"])
    assert maintenance_after["lifecycleStatus"] == "pending_renewal"
    assert maintenance_after["renewedToId"] is None


async def test_single_convert_legacy_unlinked_maintenance_renewal_preserves_exception(
    db_session, test_app, auth_headers
):
    maintenance = await _seed_legacy_unlinked_maintenance(db_session)
    successor_start = maintenance.end_date + timedelta(days=1)
    successor_end = successor_start + timedelta(days=365)
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance.id)
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    response = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    startDate=successor_start.isoformat(),
                    endDate=successor_end.isoformat(),
                )
            )
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), maintenance.id)
    assert successor["licenseType"] == "maintenance"
    assert successor["parentLicenseId"] is None
    assert successor["isLegacyUnlinkedMaintenance"] is True
    assert successor["renewedFromId"] == maintenance.id

    stored = await _get_license(test_app, auth_headers, successor["id"])
    assert stored["isLegacyUnlinkedMaintenance"] is True
    assert stored["parentLicenseId"] is None
    links = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == successor["id"]
        )
    )
    assert links.scalars().all() == []
    coverage = await db_session.execute(
        select(LicenseCoverageHistory).where(
            LicenseCoverageHistory.maintenance_license_id == successor["id"]
        )
    )
    assert coverage.scalars().all() == []

    parent = await _create_license(
        test_app, auth_headers, licenseType="perpetual", startDate="2025-01-01", endDate=None
    )
    link_response = await test_app.post(
        f"/api/licenses/{parent['id']}/link-maintenance",
        json={"maintenanceLicenseId": successor["id"]},
        headers=auth_headers,
    )
    assert link_response.status_code == 200, link_response.text
    linked_successor = await _get_license(test_app, auth_headers, successor["id"])
    assert linked_successor["parentLicenseId"] == parent["id"]
    assert linked_successor["isLegacyUnlinkedMaintenance"] is False


async def test_batch_convert_legacy_unlinked_maintenance_renewal_preserves_exception(
    db_session, test_app, auth_headers
):
    maintenance = await _seed_legacy_unlinked_maintenance(db_session)
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance.id)
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    response = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            {
                "sourcingItemId": sourcing_item["id"],
                "publisherName": "Renewal Publisher",
                "softwareDescription": "Renewed Legacy Maintenance",
                "quantity": "2",
                "unitPrice": "20",
                "totalPoPrice": "40",
                "currency": "EUR",
                "startDate": date.today().isoformat(),
                "endDate": (date.today() + timedelta(days=365)).isoformat(),
                "supplier": "Renewal Supplier",
            }
        ],
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), maintenance.id)
    assert successor["licenseType"] == "maintenance"
    assert successor["parentLicenseId"] is None
    assert successor["isLegacyUnlinkedMaintenance"] is True
    assert successor["renewedFromId"] == maintenance.id


async def test_legacy_unlinked_renewal_conversion_failure_is_atomic(
    db_session, test_app, auth_headers
):
    maintenance = await _seed_legacy_unlinked_maintenance(db_session)
    maintenance_id = maintenance.id
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance.id)
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    response = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(licenseType="not-a-license-type"))},
        headers=auth_headers,
    )

    assert response.status_code == 422
    await db_session.rollback()
    predecessor = await db_session.get(License, maintenance_id)
    successors = (
        await db_session.execute(select(License).where(License.renewed_from_id == maintenance_id))
    ).scalars().all()
    assert predecessor.lifecycle_status == "pending_renewal"
    assert predecessor.renewed_to_id is None
    assert successors == []


async def test_legacy_maintenance_linked_before_conversion_inherits_current_parent(
    db_session, test_app, auth_headers
):
    parent = await _create_license(
        test_app, auth_headers, licenseType="perpetual", startDate="2025-01-01", endDate=None
    )
    maintenance = await _seed_legacy_unlinked_maintenance(db_session)
    successor_start = maintenance.end_date + timedelta(days=1)
    successor_end = successor_start + timedelta(days=365)
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance.id)
    link_response = await test_app.post(
        f"/api/licenses/{parent['id']}/link-maintenance",
        json={"maintenanceLicenseId": maintenance.id},
        headers=auth_headers,
    )
    assert link_response.status_code == 200, link_response.text
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    response = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    startDate=successor_start.isoformat(),
                    endDate=successor_end.isoformat(),
                )
            )
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    successor = _new_successor(response.json(), maintenance.id)
    assert successor["parentLicenseId"] == parent["id"]
    assert successor["isLegacyUnlinkedMaintenance"] is False
    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == successor["id"]


# ---------------------------------------------------------------------------
# New coverage tests — targeting previously uncovered paths
# ---------------------------------------------------------------------------

async def test_convert_nonexistent_order_returns_404(test_app, auth_headers):
    resp = await test_app.post(
        "/api/pending-orders/99999/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Pending order not found"


async def test_batch_convert_nonexistent_order_returns_404(test_app, auth_headers):
    resp = await test_app.post(
        "/api/pending-orders/99999/convert-all",
        json=[_batch_convert_item(1)],
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Pending order not found"


async def test_batch_convert_already_converted_order_returns_409(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Once App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    first = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(item["id"], softwareDescription="Once App")],
        headers=auth_headers,
    )
    assert first.status_code == 200, first.text

    second = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(item["id"], softwareDescription="Once App")],
        headers=auth_headers,
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "Pending order has already been converted"


async def test_converted_pending_order_update_and_item_mutations_are_rejected(test_app, auth_headers):
    item = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Locked App")
    po = await _convert_sourcing_to_po(test_app, auth_headers, item["id"])

    first = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(item["id"], softwareDescription="Locked App")],
        headers=auth_headers,
    )
    assert first.status_code == 200, first.text

    update_order = await test_app.put(
        f"/api/pending-orders/{po['id']}",
        json={"supplier": "Changed Supplier"},
        headers=auth_headers,
    )
    update_item = await test_app.put(
        f"/api/pending-orders/{po['id']}/items/{item['id']}",
        json={"softwareDescription": "Changed App"},
        headers=auth_headers,
    )
    delete_item = await test_app.delete(
        f"/api/pending-orders/{po['id']}/items/{item['id']}",
        headers=auth_headers,
    )

    assert update_order.status_code == 409
    assert update_item.status_code == 409
    assert delete_item.status_code == 409


async def test_convert_order_with_bulk_items_creates_one_license_per_item(test_app, auth_headers):
    """Single /convert endpoint processes direct order items (no renewal) as new purchases."""
    order_resp = await test_app.post(
        "/api/pending-orders",
        json={
            "poNumber": "PO-BULK-ITEMS",
            "supplier": "Bulk Supplier",
            "notes": "Bulk PO note",
        },
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    bulk_resp = await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk",
        json=[
            {
                "publisherName": "Bulk Publisher A",
                "softwareDescription": "Bulk App A",
                "licenseType": "subscription",
                "quantity": "2",
                "estimatedUnitPrice": "50",
                "estimatedTotalPrice": "100",
                "currency": "EUR",
                "startDate": "2027-01-01",
                "endDate": "2027-12-31",
                "notes": "Line A note",
            },
            {
                "publisherName": "Bulk Publisher B",
                "softwareDescription": "Bulk App B",
                "licenseType": "saas",
                "quantity": "3",
                "estimatedUnitPrice": "30",
                "estimatedTotalPrice": "90",
                "currency": "GBP",
                "startDate": "2027-02-01",
                "endDate": "2028-01-31",
                "notes": "Line B note",
            },
        ],
        headers=auth_headers,
    )
    assert bulk_resp.status_code == 201, bulk_resp.text

    resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={
            "data": json.dumps(
                _single_convert_form(
                    poNumber="PO-BULK-ITEMS",
                    notes="Shared form note must not replace line notes",
                )
            )
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert len(converted) == 2
    assert all(item["conversionType"] == "new_purchase" for item in converted)
    converted_by_description = {item["softwareDescription"]: item for item in converted}
    expected_by_description = {
        "Bulk App A": {
            "publisherName": "Bulk Publisher A",
            "licenseType": "subscription",
            "quantity": "2",
            "unitPrice": "50",
            "totalPoPrice": "100",
            "currency": "EUR",
            "startDate": "2027-01-01",
            "endDate": "2027-12-31",
            "notes": "Purchase order notes:\nBulk PO note\n\nLine item notes:\nLine A note",
        },
        "Bulk App B": {
            "publisherName": "Bulk Publisher B",
            "licenseType": "saas",
            "quantity": "3",
            "unitPrice": "30",
            "totalPoPrice": "90",
            "currency": "GBP",
            "startDate": "2027-02-01",
            "endDate": "2028-01-31",
            "notes": "Purchase order notes:\nBulk PO note\n\nLine item notes:\nLine B note",
        },
    }
    assert converted_by_description.keys() == expected_by_description.keys()

    for description, expected in expected_by_description.items():
        converted_license = converted_by_description[description]
        _assert_license_fields(converted_license, expected)
        stored_license = await _get_license(
            test_app,
            auth_headers,
            converted_license["id"],
        )
        _assert_license_fields(stored_license, expected)


async def test_convert_renewal_item_with_missing_predecessor_returns_404(
    db_session, test_app, auth_headers
):
    """Single /convert returns 404 when the predecessor license no longer exists."""
    subscription = await _create_license(
        test_app, auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    # Bypass FK enforcement to simulate a dangling renewal_for_license_id reference.
    await db_session.execute(text("PRAGMA foreign_keys=OFF"))
    await db_session.commit()
    update_result = await db_session.execute(
        text("UPDATE sourcing_items SET renewal_for_license_id=999999 WHERE id=:id"),
        {"id": sourcing_item["id"]},
    )
    assert update_result.rowcount == 1
    await db_session.commit()
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    db_session.expire_all()

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 404
    assert "999999" in resp.json()["detail"]


async def test_batch_convert_renewal_item_with_missing_predecessor_returns_404(
    db_session, test_app, auth_headers
):
    """Batch /convert-all returns 404 when the predecessor license no longer exists."""
    subscription = await _create_license(
        test_app, auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    # Bypass FK enforcement to simulate a dangling renewal_for_license_id reference.
    await db_session.execute(text("PRAGMA foreign_keys=OFF"))
    await db_session.commit()
    update_result = await db_session.execute(
        text("UPDATE sourcing_items SET renewal_for_license_id=999999 WHERE id=:id"),
        {"id": sourcing_item["id"]},
    )
    assert update_result.rowcount == 1
    await db_session.commit()
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    db_session.expire_all()

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(sourcing_item["id"])],
        headers=auth_headers,
    )

    assert resp.status_code == 404
    assert "999999" in resp.json()["detail"]


async def test_batch_convert_oem_license_with_maintenance_links_child_to_parent(
    test_app, auth_headers
):
    """Batch convert of an OEM + maintenance pair correctly links the maintenance to the OEM."""
    oem_item = await _create_sourcing_item(
        test_app, auth_headers,
        softwareDescription="OEM Product",
        estimatedTotalPrice="5000",
    )
    maint_item = await _create_sourcing_item(
        test_app, auth_headers,
        softwareDescription="OEM Product Maintenance",
        estimatedTotalPrice="500",
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, oem_item["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, maint_item["id"], po["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[
            _batch_convert_item(
                oem_item["id"],
                softwareDescription="OEM Product",
                licenseType="oem",
                endDate=None,
                totalPoPrice="5000",
            ),
            _batch_convert_item(
                maint_item["id"],
                softwareDescription="OEM Product Maintenance",
                licenseType="maintenance",
                parentSourcingItemId=oem_item["id"],
                endDate="2027-12-31",
                totalPoPrice="500",
            ),
        ],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    oem = next(item for item in converted if item["licenseType"] == "oem")
    maintenance = next(item for item in converted if item["licenseType"] == "maintenance")
    assert maintenance["parentLicenseId"] == oem["id"]

    oem_after = await _get_license(test_app, auth_headers, oem["id"])
    assert oem_after["activeMaintenanceId"] == maintenance["id"]


async def test_concurrent_conversion_only_one_succeeds(test_app, auth_headers, db_session):
    """Two simultaneous POST /convert requests on the same order: exactly one must succeed (200)
    and the other must be rejected (409). Only 1 license should be created.

    This test FAILS before the write-lock guard (F5) is applied because both
    concurrent requests currently return 200 and create 2 licenses.
    """
    sourcing_item = await _create_sourcing_item(
        test_app, auth_headers, softwareDescription="Concurrent Conv App"
    )
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])
    order_id = po["id"]
    url = f"/api/pending-orders/{order_id}/convert"

    results = await asyncio.gather(
        test_app.post(url, data={"data": json.dumps(_single_convert_form())}, headers=auth_headers),
        test_app.post(url, data={"data": json.dumps(_single_convert_form())}, headers=auth_headers),
    )
    status_codes = {r.status_code for r in results}

    assert status_codes == {200, 409}, (
        f"Expected exactly one 200 and one 409, got: {[r.status_code for r in results]}"
    )

    await db_session.execute(text("SELECT 1"))  # ensure session is active
    result = await db_session.execute(select(License))
    licenses = result.scalars().all()
    assert len(licenses) == 1, (
        f"Expected exactly 1 license to be created, but found {len(licenses)}"
    )

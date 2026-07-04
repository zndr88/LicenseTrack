"""Integration tests for pending order conversion flows."""

import asyncio
import json

from sqlalchemy import select, text

from app.models.license import License
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.services import storage as _storage_module
from app.models.pending_order import PendingOrder


def _minimal_license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "currency": "EUR",
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
        startDate="2025-01-01",
        endDate="2025-12-31",
        unitPrice="2500",
        totalPoPrice="2500",
    )
    return parent, maintenance


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
        "poNumber": "PO-RENEW",
        "supplier": "Renewal Supplier",
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
        "poNumber": "PO-BATCH",
        "supplier": "Batch Supplier",
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
    assert converted[0]["purchaseDate"] == order_resp.json()["createdAt"]

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
                    endDate="2027-12-31",
                    totalPoPrice="500",
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
    assert {item["purchaseDate"] for item in converted} == {po["createdAt"]}


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
                endDate="2027-12-31",
                totalPoPrice="200",
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


async def test_batch_partial_conversion_only_returns_requested_item(test_app, auth_headers):
    first = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Partial App One")
    second = await _create_sourcing_item(test_app, auth_headers, softwareDescription="Partial App Two")
    po = await _convert_sourcing_to_po(test_app, auth_headers, first["id"])
    await _attach_sourcing_to_po(test_app, auth_headers, second["id"], po["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert-all",
        json=[_batch_convert_item(first["id"], softwareDescription="Partial App One")],
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert len(converted) == 1
    assert converted[0]["softwareDescription"] == "Partial App One"


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
    assert missing_item.status_code == 422
    assert empty_payload.status_code == 422


async def test_convert_po_with_maintenance_renewal_succeeds(test_app, auth_headers):
    parent, maintenance = await _create_parent_with_maintenance(test_app, auth_headers)
    parent_before = await _get_license(test_app, auth_headers, parent["id"])
    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    update_resp = await test_app.put(
        f"/api/sourcing/{sourcing_item['id']}",
        json={
            "estimatedUnitPrice": "3400",
            "estimatedTotalPrice": "3400",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), maintenance["id"])
    assert new_license["licenseType"] == "maintenance"
    assert new_license["parentLicenseId"] == parent["id"]
    assert new_license["renewedFromId"] == maintenance["id"]

    old_maintenance = await _get_license(test_app, auth_headers, maintenance["id"])
    assert old_maintenance["lifecycleStatus"] == "renewed"
    assert old_maintenance["renewedToId"] == new_license["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == new_license["id"]
    assert parent_after["maintenanceEndDate"] == new_license["endDate"]
    assert parent_after["maintenanceCost"] == new_license["totalPoPrice"] == "3400"
    assert parent_after["lifecycleStatus"] == parent_before["lifecycleStatus"]


async def test_batch_convert_with_maintenance_renewal_succeeds(test_app, auth_headers):
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
    assert new_license["renewedFromId"] == maintenance["id"]
    assert new_license["totalPoPrice"] == "4700"

    old_maintenance = await _get_license(test_app, auth_headers, maintenance["id"])
    assert old_maintenance["lifecycleStatus"] == "renewed"
    assert old_maintenance["renewedToId"] == new_license["id"]

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == new_license["id"]
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
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, subscription["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), subscription["id"])
    assert new_license["licenseType"] == "subscription"
    assert new_license["parentLicenseId"] is None
    assert new_license["renewedFromId"] == subscription["id"]
    assert new_license["predecessorId"] == subscription["id"]

    predecessor = await _get_license(test_app, auth_headers, subscription["id"])
    assert predecessor["lifecycleStatus"] == "renewed"
    assert predecessor["renewedToId"] == new_license["id"]


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
        startDate="2024-01-01",
        endDate="2024-12-31",
        totalPoPrice="2000",
    )
    maintenance_b = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        softwareDescription="Acme Server Maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
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

    po = await _convert_sourcing_to_po(test_app, auth_headers, coterm_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form(
            startDate="2026-01-01",
            endDate="2026-12-31",
            totalPoPrice="2500",
        ))},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    successor = _new_successor(resp.json(), maintenance_a["id"])
    assert successor["licenseType"] == "maintenance"
    assert successor["parentLicenseId"] == parent["id"]
    assert successor["renewedFromId"] == maintenance_a["id"]

    old_a = await _get_license(test_app, auth_headers, maintenance_a["id"])
    old_b = await _get_license(test_app, auth_headers, maintenance_b["id"])
    assert old_a["lifecycleStatus"] == "renewed"
    assert old_b["lifecycleStatus"] == "renewed"

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == successor["id"]
    assert parent_after["maintenanceEndDate"] == successor["endDate"]
    assert parent_after["maintenanceCost"] == successor["totalPoPrice"]
    assert parent_after["lifecycleStatus"] == parent_before["lifecycleStatus"]


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

    sourcing_item = await _initiate_renewal(test_app, auth_headers, maintenance["id"])
    po = await _convert_sourcing_to_po(test_app, auth_headers, sourcing_item["id"])

    resp = await test_app.post(
        f"/api/pending-orders/{po['id']}/convert",
        data={"data": json.dumps(_single_convert_form())},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    new_license = _new_successor(resp.json(), maintenance["id"])
    assert new_license["licenseType"] == "maintenance"
    assert new_license["parentLicenseId"] == 999999

    parent_after = await _get_license(test_app, auth_headers, parent["id"])
    assert parent_after["activeMaintenanceId"] == maintenance["id"]


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
        json={"poNumber": "PO-BULK-ITEMS", "supplier": "Bulk Supplier"},
        headers=auth_headers,
    )
    assert order_resp.status_code == 201, order_resp.text
    order_id = order_resp.json()["id"]

    await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk",
        json=[
            {
                "publisherName": "Bulk Publisher A",
                "softwareDescription": "Bulk App A",
                "quantity": "2",
                "estimatedUnitPrice": "50",
                "estimatedTotalPrice": "100",
                "currency": "EUR",
            },
            {
                "publisherName": "Bulk Publisher B",
                "softwareDescription": "Bulk App B",
                "quantity": "3",
                "estimatedUnitPrice": "30",
                "estimatedTotalPrice": "90",
                "currency": "EUR",
            },
        ],
        headers=auth_headers,
    )

    resp = await test_app.post(
        f"/api/pending-orders/{order_id}/convert",
        data={"data": json.dumps(_single_convert_form(poNumber="PO-BULK-ITEMS"))},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    converted = resp.json()
    assert len(converted) == 2
    assert all(item["conversionType"] == "new_purchase" for item in converted)
    assert {item["publisherName"] for item in converted} == {"Bulk Publisher A", "Bulk Publisher B"}


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
    await db_session.execute(
        text("UPDATE sourcing_items SET renewal_for_license_id=999999 WHERE id=:id"),
        {"id": sourcing_item["id"]},
    )
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()

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
    await db_session.execute(
        text("UPDATE sourcing_items SET renewal_for_license_id=999999 WHERE id=:id"),
        {"id": sourcing_item["id"]},
    )
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()

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

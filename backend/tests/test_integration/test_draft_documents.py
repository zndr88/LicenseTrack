"""Focused draft evidence scope, conversion, and rollback regressions."""

import pytest
from sqlalchemy import select

from app.models.document import ProcurementDocument
from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.services import storage
from app.services.procurement_document_transfer_service import (
    copy_quote_documents_to_procurement_documents,
    require_invoice_evidence,
)


async def _source(client, headers, **extra):
    response = await client.post(
        "/api/sourcing",
        headers=headers,
        json={
            "publisherName": "Publisher",
            "softwareDescription": "App",
            "licenseType": "freeware",
            "currency": "EUR",
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _upload(client, headers, item, **extra):
    response = await client.post(
        f"/api/sourcing/requests/{item['sourcingRequestId']}/quote-documents",
        headers=headers,
        data=extra,
        files={"file": ("evidence.pdf", b"%PDF evidence", "application/pdf")},
    )
    return response


async def test_single_source_requires_owned_line_and_prevents_line_deletion(
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    first = await _source(test_app, auth_headers)
    other = await _source(test_app, auth_headers)
    invalid = await _upload(
        test_app, auth_headers, first, scope="license", target_sourcing_item_id=other["id"], category="eula"
    )
    assert invalid.status_code == 422
    uploaded = await _upload(
        test_app, auth_headers, first, scope="license", target_sourcing_item_id=first["id"], category="eula"
    )
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["category"] == "eula"
    assert uploaded.json()["targetSourcingItemId"] == first["id"]
    deleted = await test_app.delete(f"/api/sourcing/{first['id']}", headers=auth_headers)
    assert deleted.status_code == 409, deleted.text


async def test_source_transfer_preserves_categories_split_scope_and_legacy_sharing(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    request = SourcingRequest()
    orders = [PendingOrder(po_number="PO-A"), PendingOrder(po_number="PO-B")]
    db_session.add_all([request, *orders])
    await db_session.flush()
    items = [
        SourcingItem(
            sourcing_request_id=request.id,
            pending_order_id=order.id,
            publisher_name="P",
            software_description="S",
            currency="EUR",
        )
        for order in orders
    ]
    db_session.add_all(items)
    await db_session.flush()
    sources = []
    for index, (category, target, shared) in enumerate(
        [
            ("eula", items[0].id, False),
            ("entitlement", items[1].id, False),
            ("invoice", None, True),
            ("quote", None, False),
        ]
    ):
        filename = f"source-{index}.pdf"
        (tmp_path / filename).write_bytes(b"source evidence")
        sources.append(
            SourcingQuoteDocument(
                sourcing_request_id=request.id,
                category=category,
                target_sourcing_item_id=target,
                shared_upload=shared,
                filename=filename,
                original_filename=filename,
                file_size=15,
                mime_type="application/pdf",
            )
        )
    db_session.add_all(sources)
    await db_session.commit()
    for order in orders:
        await copy_quote_documents_to_procurement_documents(db_session, order.po_number, order.id, [request.id], None)
        await copy_quote_documents_to_procurement_documents(db_session, order.po_number, order.id, [request.id], None)
        documents = (
            await db_session.scalars(
                select(ProcurementDocument).where(
                    ProcurementDocument.pending_order_id == order.id,
                )
            )
        ).all()
        assert len(documents) == 3
        assert {doc.category.value for doc in documents} == {
            "invoice",
            "quote",
            "eula" if order.id == orders[0].id else "entitlement",
        }
        assert next(doc for doc in documents if doc.category.value == "invoice").shared_po_number == order.po_number
        assert next(doc for doc in documents if doc.category.value == "quote").shared_po_number is None


@pytest.mark.parametrize("by_request", [False, True])
async def test_direct_freeware_copies_source_documents_locally(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
    by_request,
):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    item = await _source(test_app, auth_headers)
    upload = await _upload(
        test_app, auth_headers, item, scope="license", category="entitlement", target_sourcing_item_id=item["id"]
    )
    assert upload.status_code == 201, upload.text
    suffix = f"requests/{item['sourcingRequestId']}" if by_request else str(item["id"])
    converted = await test_app.post(f"/api/sourcing/{suffix}/convert-freeware", headers=auth_headers)
    assert converted.status_code == 200, converted.text
    row = converted.json()[0] if by_request else converted.json()
    documents = (
        await db_session.scalars(
            select(ProcurementDocument).where(
                ProcurementDocument.license_id == row["id"],
            )
        )
    ).all()
    assert len(documents) == 1
    document = documents[0]
    assert document.category.value == "entitlement"
    assert document.shared_po_number is None
    assert document.filename != upload.json()["filename"]
    assert storage.get_file_path(document.filename).read_bytes() == b"%PDF evidence"
    assert storage.get_file_path(upload.json()["filename"]).exists()


async def test_freeware_commit_failure_rolls_back_license_and_cleans_only_copies(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    item = await _source(test_app, auth_headers)
    upload = await _upload(test_app, auth_headers, item)
    assert upload.status_code == 201
    files_before = {p for p in tmp_path.rglob("*") if p.is_file()}

    async def fail_commit():
        raise RuntimeError("forced commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    response = await test_app.post(f"/api/sourcing/{item['id']}/convert-freeware", headers=auth_headers)
    assert response.status_code == 500
    assert (await db_session.scalars(select(License))).all() == []
    assert (await db_session.scalars(select(ProcurementDocument))).all() == []
    assert {p for p in tmp_path.rglob("*") if p.is_file()} == files_before


async def test_mixed_conversion_keeps_single_source_evidence_on_its_selected_path(
    test_app,
    auth_headers,
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    response = await test_app.post(
        "/api/sourcing/requests",
        headers=auth_headers,
        json={
            "items": [
                {"publisherName": "P", "softwareDescription": "Paid", "licenseType": "subscription"},
                {"publisherName": "P", "softwareDescription": "Free", "licenseType": "freeware"},
            ],
        },
    )
    assert response.status_code == 201, response.text
    request = response.json()
    paid, freeware = request["items"]
    for item in [paid, freeware]:
        upload = await _upload(
            test_app, auth_headers, item, scope="license", category="eula", target_sourcing_item_id=item["id"]
        )
        assert upload.status_code == 201, upload.text
    converted = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert",
        headers=auth_headers,
        json={"poNumber": "MIXED-PO", "supplier": "Supplier"},
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()["directRegistryCount"] == 1
    source_documents = converted.json()["items"][0]["quoteDocuments"]
    assert len(source_documents) == 1
    assert source_documents[0]["targetSourcingItemId"] == paid["id"]
    copied = (await db_session.scalars(select(ProcurementDocument))).all()
    assert len(copied) == 1
    license_obj = await db_session.get(License, copied[0].license_id)
    assert license_obj.source_sourcing_item_id == freeware["id"]


async def test_pending_order_single_upload_validates_line_and_blocks_deletion(
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    source = await _source(test_app, auth_headers, licenseType="subscription")
    response = await test_app.post(
        f"/api/sourcing/{source['id']}/convert",
        headers=auth_headers,
        json={"poNumber": "DRAFT-PO", "supplier": "Supplier"},
    )
    assert response.status_code == 200, response.text
    order = response.json()
    path = f"/api/pending-orders/{order['id']}/documents"
    invalid = await test_app.post(
        path,
        headers=auth_headers,
        data={"scope": "license", "target_sourcing_item_id": 999, "category": "entitlement"},
        files={"file": ("key.pdf", b"key", "application/pdf")},
    )
    assert invalid.status_code == 422
    valid = await test_app.post(
        path,
        headers=auth_headers,
        data={"scope": "license", "target_sourcing_item_id": source["id"], "category": "entitlement"},
        files={"file": ("key.pdf", b"key", "application/pdf")},
    )
    assert valid.status_code == 201, valid.text
    assert valid.json()["target_sourcing_item_id"] == source["id"]
    assert valid.json()["shared_po_number"] is None
    deleted = await test_app.delete(f"/api/pending-orders/{order['id']}/items/{source['id']}", headers=auth_headers)
    assert deleted.status_code == 409, deleted.text


async def test_single_invoice_cannot_satisfy_required_shared_conversion_evidence(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(tmp_path))
    order = PendingOrder(po_number="INVOICE-PO")
    db_session.add(order)
    await db_session.flush()
    (tmp_path / "single.pdf").write_bytes(b"single")
    db_session.add(
        ProcurementDocument(
            pending_order_id=order.id,
            po_number=order.po_number,
            target_sourcing_item_id=12,
            category="invoice",
            filename="single.pdf",
            original_filename="single.pdf",
            file_size=6,
            mime_type="application/pdf",
        )
    )
    await db_session.commit()
    with pytest.raises(RuntimeError, match="Required invoice evidence is missing"):
        await require_invoice_evidence(db_session, order.id)
    (tmp_path / "shared.pdf").write_bytes(b"shared")
    db_session.add(
        ProcurementDocument(
            pending_order_id=order.id,
            po_number=order.po_number,
            category="invoice",
            filename="shared.pdf",
            original_filename="shared.pdf",
            file_size=6,
            mime_type="application/pdf",
        )
    )
    await db_session.commit()
    await require_invoice_evidence(db_session, order.id)

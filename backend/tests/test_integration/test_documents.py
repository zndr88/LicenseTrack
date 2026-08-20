"""
Integration tests for document upload/list/download/delete routes.

Tests the HTTP contract for:
  POST   /api/licenses/{id}/documents
  GET    /api/licenses/{id}/documents
  DELETE /api/documents/{id}

Storage is redirected to a pytest tmp_path by patching settings.STORAGE_PATH
on the singleton settings object (same instance across all app modules).
"""

import pytest
import bcrypt
from sqlalchemy import select

import app.services.storage as _storage_module
from app.config import settings
from app.models.audit_log import AuditLog
from app.models.document import Document, DocumentCategory, ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess
from app.services.reference_data_service import resolve_cost_centre
from app.services.settings_service import invalidate_global_settings_cache


# ---------------------------------------------------------------------------
# Autouse fixture — redirect all document storage to tmp_path
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "documents").mkdir()
    return tmp_path


# ---------------------------------------------------------------------------
# Shared fixture — a license that document tests can attach files to
# ---------------------------------------------------------------------------

@pytest.fixture
async def existing_license(test_app, auth_headers) -> int:
    payload = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "currency": "EUR",
    }
    resp = await test_app.post("/api/licenses", json=payload, headers=auth_headers)
    assert resp.status_code == 201, f"existing_license setup failed: {resp.text}"
    return resp.json()["id"]


async def _create_viewer(
    db_session,
    username: str,
    departments: list[str] | None = None,
    *,
    allow_downloads: bool = True,
) -> tuple[User, dict]:
    password = f"viewerpass_{username}"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    viewer = User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        allow_downloads=allow_downloads,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()
    for department in departments or []:
        cost_centre = await resolve_cost_centre(db_session, department, create_if_missing=True)
        db_session.add(UserDepartmentAccess(user_id=viewer.id, department=cost_centre.name, cost_centre_id=cost_centre.id))
    await db_session.commit()

    return viewer, {"username": username, "password": password}


async def _login(test_app, username: str, password: str) -> dict:
    response = await test_app.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ---------------------------------------------------------------------------
# 4a — Upload a valid PDF file
# ---------------------------------------------------------------------------

async def test_upload_valid_pdf(test_app, auth_headers, existing_license):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("test.pdf", b"%PDF-1.4 minimal", "application/pdf")}
    data = {"category": "invoice"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 201
    body = resp.json()
    assert body["original_filename"] == "test.pdf"
    assert body["category"] == "invoice"


# ---------------------------------------------------------------------------
# 4b — Upload a disallowed extension returns 422
# ---------------------------------------------------------------------------

async def test_upload_invalid_extension(test_app, auth_headers, existing_license):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("malware.exe", b"MZ\x90\x00", "application/octet-stream")}
    data = {"category": "other"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 422


async def test_upload_allows_allowed_extension_and_mime(
    test_app, auth_headers, existing_license
):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("evidence.csv", b"name,value\none,1\n", "text/csv")}
    data = {"category": "other"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 201
    assert resp.json()["original_filename"] == "evidence.csv"


async def test_upload_blocks_allowed_extension_with_blocked_mime(
    test_app, auth_headers, existing_license
):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("invoice.pdf", b"<script>alert(1)</script>", "text/html")}
    data = {"category": "invoice"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 422
    assert "MIME type" in resp.json()["detail"]


async def test_upload_blocks_blocked_extension_with_allowed_mime(
    test_app, auth_headers, existing_license
):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("payload.exe", b"%PDF-1.4", "application/pdf")}
    data = {"category": "other"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 422
    assert "File extension" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 4c — Path traversal in filename is sanitised; upload succeeds
#
# storage.save_file stores only a generated filesystem name plus a vetted
# extension, so "../../etc/passwd.pdf" cannot influence the path.
# ---------------------------------------------------------------------------

async def test_upload_path_traversal_sanitised(test_app, auth_headers, existing_license):
    url = f"/api/licenses/{existing_license}/documents"
    # Include a .pdf extension so the extension check passes; the traversal
    # prefix tests that the storage layer sanitises the filename correctly.
    files = {"file": ("../../etc/passwd.pdf", b"%PDF-1.4 minimal", "application/pdf")}
    data = {"category": "other"}

    resp = await test_app.post(url, files=files, data=data, headers=auth_headers)

    assert resp.status_code == 201
    assert "id" in resp.json()


# ---------------------------------------------------------------------------
# 4d — GET documents list returns uploaded documents
# ---------------------------------------------------------------------------

async def test_list_documents(test_app, auth_headers, existing_license):
    url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")}
    data = {"category": "invoice"}

    await test_app.post(url, files=files, data=data, headers=auth_headers)

    resp = await test_app.get(url, headers=auth_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_license_overview_counts_license_scoped_procurement_documents(test_app, auth_headers):
    license_payload = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Shared PO Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "currency": "EUR",
        "poNumber": "PO-SHARED-1",
    }
    first_resp = await test_app.post("/api/licenses", json=license_payload, headers=auth_headers)
    second_resp = await test_app.post(
        "/api/licenses",
        json={**license_payload, "softwareDescription": "Shared PO Add-on"},
        headers=auth_headers,
    )
    assert first_resp.status_code == 201
    assert second_resp.status_code == 201
    first_id = first_resp.json()["id"]
    second_id = second_resp.json()["id"]

    quote_resp = await test_app.post(
        f"/api/licenses/{first_id}/documents",
        files={"file": ("quote.pdf", b"%PDF-1.4 quote", "application/pdf")},
        data={"category": "quote"},
        headers=auth_headers,
    )
    eula_resp = await test_app.post(
        f"/api/licenses/{first_id}/documents",
        files={"file": ("eula.pdf", b"%PDF-1.4 eula", "application/pdf")},
        data={"category": "eula"},
        headers=auth_headers,
    )
    assert quote_resp.status_code == 201
    assert quote_resp.json()["scope"] == "po"
    assert eula_resp.status_code == 201
    assert eula_resp.json()["scope"] == "license"

    list_resp = await test_app.get("/api/licenses?include_retired=true", headers=auth_headers)
    assert list_resp.status_code == 200
    counts = {
        license_row["id"]: license_row["documentCount"]
        for license_row in list_resp.json()
        if license_row["id"] in {first_id, second_id}
    }

    assert counts == {
        first_id: 2,
        second_id: 0,
    }


async def test_manual_batch_procurement_document_is_shared_without_po_number_fallback(
    test_app,
    auth_headers,
    db_session,
):
    db_session.add(GlobalSettings(id=1, mandatory_fields={"invoice": True}))
    await db_session.commit()
    invalidate_global_settings_cache()

    license_payload = {
        "publisherName": "Acme Corp",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "currency": "EUR",
        "poNumber": "PO-MANUAL-SHARED",
    }
    batch_resp = await test_app.post(
        "/api/licenses/batch",
        json={
            "items": [
                {"license": {**license_payload, "softwareDescription": "Manual Bundle A"}},
                {"license": {**license_payload, "softwareDescription": "Manual Bundle B"}},
            ]
        },
        headers=auth_headers,
    )
    unrelated_resp = await test_app.post(
        "/api/licenses/batch",
        json={
            "items": [
                {"license": {**license_payload, "softwareDescription": "Unrelated A"}},
                {"license": {**license_payload, "softwareDescription": "Unrelated B"}},
            ]
        },
        headers=auth_headers,
    )
    assert batch_resp.status_code == 201, batch_resp.text
    assert unrelated_resp.status_code == 201, unrelated_resp.text
    created = batch_resp.json()
    unrelated = unrelated_resp.json()
    bundle_id = created[0]["procurementBundleId"]
    assert bundle_id
    assert created[1]["procurementBundleId"] == bundle_id
    assert unrelated[0]["procurementBundleId"] != bundle_id

    upload_resp = await test_app.post(
        f"/api/licenses/{created[0]['id']}/documents",
        files={"file": ("shared-invoice.pdf", b"%PDF-1.4 shared", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document = upload_resp.json()
    assert document["license_id"] is None
    assert document["procurement_bundle_id"] == bundle_id

    eula_resp = await test_app.post(
        f"/api/licenses/{created[0]['id']}/documents",
        files={"file": ("license-eula.pdf", b"%PDF-1.4 eula", "application/pdf")},
        data={"category": "eula"},
        headers=auth_headers,
    )
    assert eula_resp.status_code == 201, eula_resp.text
    eula_document = eula_resp.json()
    assert eula_document["scope"] == "license"

    first_docs = await test_app.get(f"/api/licenses/{created[0]['id']}/documents", headers=auth_headers)
    second_docs = await test_app.get(f"/api/licenses/{created[1]['id']}/documents", headers=auth_headers)
    unrelated_docs = await test_app.get(
        f"/api/licenses/{unrelated[0]['id']}/documents",
        headers=auth_headers,
    )
    assert {doc["id"] for doc in first_docs.json()} == {document["id"], eula_document["id"]}
    assert [doc["id"] for doc in second_docs.json()] == [document["id"]]
    assert unrelated_docs.json() == []

    list_resp = await test_app.get("/api/licenses?include_retired=true", headers=auth_headers)
    rows = {row["id"]: row for row in list_resp.json()}
    assert rows[created[0]["id"]]["documentCount"] == 2
    assert rows[created[0]["id"]]["completenessPct"] == 100
    assert rows[created[1]["id"]]["documentCount"] == 1
    assert rows[created[1]["id"]]["completenessPct"] == 100
    assert rows[unrelated[0]["id"]]["documentCount"] == 0
    assert rows[unrelated[0]["id"]]["completenessPct"] == 0

    first_delete = await test_app.delete(f"/api/licenses/{created[0]['id']}", headers=auth_headers)
    assert first_delete.status_code == 204
    surviving_docs = await test_app.get(
        f"/api/licenses/{created[1]['id']}/documents",
        headers=auth_headers,
    )
    assert [doc["id"] for doc in surviving_docs.json()] == [document["id"]]

    second_delete = await test_app.delete(f"/api/licenses/{created[1]['id']}", headers=auth_headers)
    assert second_delete.status_code == 204
    assert await db_session.get(ProcurementDocument, document["id"]) is None
    invalidate_global_settings_cache()


async def test_procurement_document_download_and_delete(test_app, auth_headers):
    license_resp = await test_app.post(
        "/api/licenses",
        json={
            "publisherName": "Acme Corp",
            "softwareDescription": "Procurement Doc Suite",
            "licenseType": "subscription",
            "licenseMetric": "per_user",
            "quantity": "1",
            "currency": "EUR",
            "poNumber": "PO-PROC-DOC",
        },
        headers=auth_headers,
    )
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    content = b"%PDF-1.4 procurement quote"
    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        files={"file": ("procurement-quote.pdf", content, "application/pdf")},
        data={"category": "quote"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    body = upload_resp.json()
    assert body["scope"] == "po"

    download_resp = await test_app.get(
        f"/api/procurement-documents/{body['id']}/download",
        headers=auth_headers,
    )
    assert download_resp.status_code == 200
    assert download_resp.content == content
    assert "procurement-quote.pdf" in download_resp.headers["content-disposition"]

    delete_resp = await test_app.delete(
        f"/api/procurement-documents/{body['id']}",
        headers=auth_headers,
    )
    assert delete_resp.status_code == 204
    assert delete_resp.content == b""

    list_resp = await test_app.get(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


async def test_post_conversion_procurement_upload_audit_is_document_amendment(
    test_app,
    auth_headers,
    db_session,
):
    order = PendingOrder(
        po_number="PO-AMEND-UPLOAD",
        supplier="Audit Supplier",
        status=PendingOrderStatus.converted,
    )
    db_session.add(order)
    await db_session.flush()
    license_obj = License(
        publisher_name="Audit Corp",
        software_description="Converted Audit Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        currency="EUR",
        po_number=order.po_number,
        pending_order_id=order.id,
    )
    db_session.add(license_obj)
    await db_session.commit()

    upload_resp = await test_app.post(
        f"/api/licenses/{license_obj.id}/documents",
        files={"file": ("late-invoice.pdf", b"%PDF-1.4 invoice", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )

    assert upload_resp.status_code == 201, upload_resp.text
    audit = await db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "procurement_document.uploaded")
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    detail = audit.detail
    assert "mutationType=document_amendment" in detail
    assert "operation=upload" in detail
    assert "postConversion=true" in detail
    assert "documentCategory=invoice" in detail
    assert "documentScope=procurement" in detail
    assert f"relatedLicenseId={license_obj.id}" in detail
    assert f"pendingOrderId={order.id}" in detail
    assert "poNumber=PO-AMEND-UPLOAD" in detail
    assert "actorEmail=" in detail
    assert "amendmentTimestamp=" in detail


async def test_post_conversion_procurement_delete_audit_includes_reason(
    test_app,
    auth_headers,
    db_session,
):
    order = PendingOrder(
        po_number="PO-AMEND-DELETE",
        supplier="Audit Supplier",
        status=PendingOrderStatus.converted,
    )
    db_session.add(order)
    await db_session.flush()
    license_obj = License(
        publisher_name="Audit Corp",
        software_description="Converted Delete Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        currency="EUR",
        po_number=order.po_number,
        pending_order_id=order.id,
    )
    db_session.add(license_obj)
    await db_session.commit()

    upload_resp = await test_app.post(
        f"/api/licenses/{license_obj.id}/documents",
        files={"file": ("wrong-invoice.pdf", b"%PDF-1.4 invoice", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    delete_resp = await test_app.delete(
        f"/api/procurement-documents/{document_id}?reason=duplicate%20invoice",
        headers=auth_headers,
    )

    assert delete_resp.status_code == 204
    audit = await db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "procurement_document.deleted")
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    detail = audit.detail
    assert "mutationType=document_amendment" in detail
    assert "operation=delete" in detail
    assert "postConversion=true" in detail
    assert "documentCategory=invoice" in detail
    assert f"relatedLicenseId={license_obj.id}" in detail
    assert f"pendingOrderId={order.id}" in detail
    assert "reason=duplicate invoice" in detail


async def test_pending_order_document_delete_audit_includes_reason(
    test_app,
    auth_headers,
    db_session,
):
    order = PendingOrder(
        po_number="PO-PENDING-AMEND",
        supplier="Audit Supplier",
        status=PendingOrderStatus.converted,
    )
    db_session.add(order)
    await db_session.commit()

    upload_resp = await test_app.post(
        f"/api/pending-orders/{order.id}/documents",
        files={"file": ("obsolete-po.pdf", b"%PDF-1.4 po", "application/pdf")},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    delete_resp = await test_app.delete(
        f"/api/pending-orders/documents/{document_id}?reason=superseded%20purchase%20order",
        headers=auth_headers,
    )

    assert delete_resp.status_code == 204
    audit = await db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "procurement_document.deleted")
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    detail = audit.detail
    assert "mutationType=document_amendment" in detail
    assert "operation=delete" in detail
    assert "postConversion=true" in detail
    assert "documentCategory=purchase_order" in detail
    assert f"pendingOrderId={order.id}" in detail
    assert "poNumber=PO-PENDING-AMEND" in detail
    assert "reason=superseded purchase order" in detail


async def test_download_document_success(
    test_app, auth_headers, existing_license
):
    upload_url = f"/api/licenses/{existing_license}/documents"
    content = b"%PDF-1.4 downloadable"
    files = {"file": ("download-me.pdf", content, "application/pdf")}
    data = {"category": "invoice"}

    upload_resp = await test_app.post(
        upload_url, files=files, data=data, headers=auth_headers
    )
    assert upload_resp.status_code == 201
    doc_id = upload_resp.json()["id"]

    resp = await test_app.get(
        f"/api/documents/{doc_id}/download",
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.content == content
    assert resp.headers["content-type"].startswith("application/pdf")
    assert "download-me.pdf" in resp.headers["content-disposition"]


async def test_download_missing_file_on_disk_returns_404(
    test_app, auth_headers, existing_license, patch_storage
):
    upload_url = f"/api/licenses/{existing_license}/documents"
    upload_resp = await test_app.post(
        upload_url,
        files={"file": ("missing.pdf", b"%PDF-1.4", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201
    body = upload_resp.json()
    (patch_storage / body["filename"]).unlink()

    resp = await test_app.get(
        f"/api/documents/{body['id']}/download",
        headers=auth_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "The document record exists, but the file is missing from managed storage."


async def test_list_documents_reports_file_availability_and_preserves_missing_metadata(
    db_session,
    test_app,
    auth_headers,
    existing_license,
    patch_storage,
):
    available_path = f"documents/{existing_license}/available.pdf"
    missing_path = f"documents/{existing_license}/missing.pdf"
    (patch_storage / available_path).parent.mkdir(parents=True, exist_ok=True)
    (patch_storage / available_path).write_bytes(b"%PDF-1.4 available")
    available = Document(
        license_id=existing_license,
        filename=available_path,
        original_filename="available.pdf",
        file_size=18,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    missing = Document(
        license_id=existing_license,
        filename=missing_path,
        original_filename="missing.pdf",
        file_size=17,
        mime_type="application/pdf",
        category=DocumentCategory.eula,
    )
    db_session.add_all([available, missing])
    await db_session.commit()

    list_resp = await test_app.get(f"/api/licenses/{existing_license}/documents", headers=auth_headers)
    license_resp = await test_app.get(f"/api/licenses/{existing_license}", headers=auth_headers)

    assert list_resp.status_code == 200, list_resp.text
    by_name = {doc["original_filename"]: doc for doc in list_resp.json()}
    assert by_name["available.pdf"]["file_availability"] == "available"
    assert by_name["missing.pdf"]["file_availability"] == "missing"
    assert await db_session.get(Document, missing.id) is not None
    assert license_resp.status_code == 200, license_resp.text
    license_body = license_resp.json()
    assert license_body["documentCount"] == 2
    assert license_body["availableDocumentCount"] == 1
    assert license_body["missingDocumentCount"] == 1


async def test_list_documents_reports_unavailable_when_storage_check_fails(
    db_session,
    test_app,
    auth_headers,
    existing_license,
    patch_storage,
    monkeypatch,
):
    stored_path = f"documents/{existing_license}/unstable.pdf"
    document = Document(
        license_id=existing_license,
        filename=stored_path,
        original_filename="unstable.pdf",
        file_size=18,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()

    def fail_exists(_path):
        raise OSError("storage backend unavailable")

    monkeypatch.setattr(_storage_module._backend, "exists", fail_exists)

    resp = await test_app.get(f"/api/licenses/{existing_license}/documents", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["file_availability"] == "unavailable"


async def test_list_documents_does_not_escape_storage_for_unsafe_metadata(
    db_session,
    test_app,
    auth_headers,
    existing_license,
):
    document = Document(
        license_id=existing_license,
        filename="../outside.pdf",
        original_filename="outside.pdf",
        file_size=1,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()

    resp = await test_app.get(f"/api/licenses/{existing_license}/documents", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["file_availability"] == "unavailable"


async def test_download_rejects_traversal_stored_path(
    db_session, test_app, auth_headers, existing_license
):
    document = Document(
        license_id=existing_license,
        filename="../outside.pdf",
        original_filename="outside.pdf",
        file_size=1,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()

    resp = await test_app.get(
        f"/api/documents/{document.id}/download",
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid file path."


async def test_upload_returns_503_when_storage_path_unconfigured(
    test_app, auth_headers, existing_license, tmp_path, monkeypatch
):
    missing_storage = tmp_path / "missing-storage"
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(missing_storage))

    resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )

    assert resp.status_code == 503
    assert "Document storage is not configured" in resp.json()["detail"]


async def test_upload_returns_503_when_custom_storage_path_is_invalid(
    db_session, test_app, auth_headers, existing_license, tmp_path
):
    invalid_storage = tmp_path / "storage-is-a-file"
    invalid_storage.write_text("not a directory")
    db_session.add(GlobalSettings(id=1, storage_path=str(invalid_storage)))
    await db_session.commit()

    resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )

    assert resp.status_code == 503
    assert "Document storage is not configured" in resp.json()["detail"]


async def test_viewer_can_download_document_in_assigned_department(
    db_session, test_app, patch_storage
):
    viewer, credentials = await _create_viewer(db_session, "doc_owner", ["IT"])
    license_obj = License(
        publisher_name="Acme",
        software_description="Viewer Owned Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        cost_centre="IT",
        created_by=viewer.id,
    )
    db_session.add(license_obj)
    await db_session.flush()
    license_obj.cost_centre_id = (await resolve_cost_centre(db_session, "IT", create_if_missing=True)).id

    stored_path = f"documents/{license_obj.id}/viewer.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 viewer")
    document = Document(
        license_id=license_obj.id,
        filename=stored_path,
        original_filename="viewer.pdf",
        file_size=15,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()
    headers = await _login(test_app, credentials["username"], credentials["password"])

    resp = await test_app.get(
        f"/api/documents/{document.id}/download",
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.content == b"%PDF-1.4 viewer"


async def test_viewer_without_downloads_can_list_but_not_download_in_assigned_department(
    db_session, test_app, patch_storage
):
    viewer, credentials = await _create_viewer(
        db_session,
        "doc_read_only_viewer",
        ["IT"],
        allow_downloads=False,
    )
    license_obj = License(
        publisher_name="Acme",
        software_description="Read Only Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        cost_centre="IT",
        created_by=viewer.id,
    )
    db_session.add(license_obj)
    await db_session.flush()
    license_obj.cost_centre_id = (await resolve_cost_centre(db_session, "IT", create_if_missing=True)).id

    stored_path = f"documents/{license_obj.id}/read-only.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 read only")
    document = Document(
        license_id=license_obj.id,
        filename=stored_path,
        original_filename="read-only.pdf",
        file_size=18,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()
    headers = await _login(test_app, credentials["username"], credentials["password"])

    list_resp = await test_app.get(
        f"/api/licenses/{license_obj.id}/documents",
        headers=headers,
    )
    download_resp = await test_app.get(
        f"/api/documents/{document.id}/download",
        headers=headers,
    )

    assert list_resp.status_code == 200
    assert [doc["id"] for doc in list_resp.json()] == [document.id]
    assert download_resp.status_code == 403
    assert download_resp.json()["detail"] == "Downloads are disabled for this viewer"


async def test_viewer_cannot_download_document_outside_assigned_department(
    db_session, test_app, existing_license, patch_storage
):
    _, credentials = await _create_viewer(db_session, "doc_non_owner", ["IT"])
    stored_path = f"documents/{existing_license}/admin.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 admin")
    document = Document(
        license_id=existing_license,
        filename=stored_path,
        original_filename="admin.pdf",
        file_size=14,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()
    headers = await _login(test_app, credentials["username"], credentials["password"])

    resp = await test_app.get(
        f"/api/documents/{document.id}/download",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found"


async def test_procurement_document_download_does_not_authorize_by_po_number_only(
    db_session, test_app, patch_storage
):
    _, credentials = await _create_viewer(db_session, "po_fallback_viewer", ["IT"])
    license_obj = License(
        publisher_name="Acme",
        software_description="Visible PO Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        cost_centre="IT",
        po_number="PO-SHARED",
    )
    db_session.add(license_obj)
    await db_session.flush()

    stored_path = "procurement/PO-SHARED/orphan.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 orphan procurement")
    document = ProcurementDocument(
        po_number="PO-SHARED",
        pending_order_id=None,
        license_id=None,
        filename=stored_path,
        original_filename="orphan.pdf",
        file_size=26,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.purchase_order,
    )
    db_session.add(document)
    await db_session.commit()
    headers = await _login(test_app, credentials["username"], credentials["password"])

    resp = await test_app.get(
        f"/api/procurement-documents/{document.id}/download",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found"


# ---------------------------------------------------------------------------
# 4e — GET documents for a nonexistent license returns 404
# ---------------------------------------------------------------------------

async def test_list_documents_nonexistent_license(test_app, auth_headers):
    resp = await test_app.get("/api/licenses/999999/documents", headers=auth_headers)

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 4f — DELETE document removes it; subsequent list returns 0 entries
# ---------------------------------------------------------------------------

async def test_delete_document(test_app, auth_headers, existing_license):
    upload_url = f"/api/licenses/{existing_license}/documents"
    files = {"file": ("receipt.pdf", b"%PDF-1.4", "application/pdf")}
    data = {"category": "invoice"}

    upload_resp = await test_app.post(upload_url, files=files, data=data, headers=auth_headers)
    assert upload_resp.status_code == 201
    doc_id = upload_resp.json()["id"]

    del_resp = await test_app.delete(f"/api/documents/{doc_id}", headers=auth_headers)
    assert del_resp.status_code == 204

    list_resp = await test_app.get(upload_url, headers=auth_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 0


async def test_delete_document_succeeds_when_file_is_already_missing(
    test_app, auth_headers, existing_license, patch_storage
):
    upload_url = f"/api/licenses/{existing_license}/documents"
    upload_resp = await test_app.post(
        upload_url,
        files={"file": ("gone.pdf", b"%PDF-1.4", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201
    body = upload_resp.json()
    (patch_storage / body["filename"]).unlink()

    del_resp = await test_app.delete(
        f"/api/documents/{body['id']}",
        headers=auth_headers,
    )

    assert del_resp.status_code == 204
    list_resp = await test_app.get(upload_url, headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json() == []


# ---------------------------------------------------------------------------
# License deletion cleans up managed document files after a successful commit
# ---------------------------------------------------------------------------

async def test_delete_license_removes_its_managed_document_file(
    test_app, auth_headers, existing_license, patch_storage
):
    upload_resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("license-owned.pdf", b"%PDF-1.4 managed", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201
    target = patch_storage / upload_resp.json()["filename"]
    assert target.is_file()

    delete_resp = await test_app.delete(
        f"/api/licenses/{existing_license}",
        headers=auth_headers,
    )

    assert delete_resp.status_code == 204
    assert not target.exists()


async def test_bulk_delete_licenses_removes_all_managed_document_files(
    test_app, auth_headers, existing_license, patch_storage
):
    second_resp = await test_app.post(
        "/api/licenses",
        json={
            "publisherName": "Acme Corp",
            "softwareDescription": "Second Managed License",
            "licenseType": "subscription",
            "licenseMetric": "per_user",
            "quantity": "1",
            "currency": "EUR",
        },
        headers=auth_headers,
    )
    assert second_resp.status_code == 201
    second_license_id = second_resp.json()["id"]

    targets = []
    for license_id, filename in (
        (existing_license, "first-managed.pdf"),
        (second_license_id, "second-managed.pdf"),
    ):
        upload_resp = await test_app.post(
            f"/api/licenses/{license_id}/documents",
            files={"file": (filename, b"%PDF-1.4 managed", "application/pdf")},
            data={"category": "invoice"},
            headers=auth_headers,
        )
        assert upload_resp.status_code == 201
        targets.append(patch_storage / upload_resp.json()["filename"])

    delete_resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": [existing_license, second_license_id]},
        headers=auth_headers,
    )

    assert delete_resp.status_code == 200
    assert delete_resp.json()["deleted"] == 2
    assert all(not target.exists() for target in targets)


async def test_rejected_license_delete_keeps_managed_document_file(
    test_app, auth_headers, existing_license, db_session, patch_storage
):
    upload_resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("kept-after-rollback.pdf", b"%PDF-1.4 kept", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201
    target = patch_storage / upload_resp.json()["filename"]

    db_session.add(
        SourcingItem(
            publisher_name="Acme Corp",
            software_description="Blocked renewal",
            status=SourcingStatus.sourcing,
            renewal_for_license_id=existing_license,
        )
    )
    await db_session.commit()

    delete_resp = await test_app.delete(
        f"/api/licenses/{existing_license}",
        headers=auth_headers,
    )

    assert delete_resp.status_code == 409
    assert target.is_file()


# ---------------------------------------------------------------------------
# F10 — payload and Content-Length upload boundaries
# ---------------------------------------------------------------------------

async def test_document_upload_accepts_exact_limit_and_rejects_one_byte_over(
    test_app, auth_headers, existing_license, monkeypatch
):
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 1)
    max_bytes = 1024 * 1024
    pdf_header = b"%PDF-1.4\n"
    exact_payload = pdf_header + b"0" * (max_bytes - len(pdf_header))

    exact_resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("exact.pdf", exact_payload, "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )
    over_resp = await test_app.post(
        f"/api/licenses/{existing_license}/documents",
        files={"file": ("over.pdf", exact_payload + b"0", "application/pdf")},
        data={"category": "invoice"},
        headers=auth_headers,
    )

    assert exact_resp.status_code == 201
    assert over_resp.status_code == 413


async def test_document_upload_rejects_oversized_content_length(
    test_app, auth_headers, existing_license
):
    oversized_cl = str((settings.MAX_UPLOAD_SIZE_MB + 1) * 1024 * 1024 + 1)
    url = f"/api/licenses/{existing_license}/documents"

    resp = await test_app.post(
        url,
        content=b"%PDF-1.4 small",
        headers={**auth_headers, "content-length": oversized_cl},
    )

    assert resp.status_code == 413

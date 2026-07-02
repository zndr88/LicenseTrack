import pytest
from sqlalchemy import select

import app.services.storage as _storage_module
from app.models.audit_log import AuditLog
from app.models.custom_fields import CustomFieldValue
from app.models.document_processing import DocumentProcessingResult
from app.models.license import License


@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "documents").mkdir()
    return tmp_path


def _minimal_license_payload() -> dict:
    return {
        "publisherName": "Processing Corp",
        "softwareDescription": "Processing Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "5",
        "currency": "EUR",
    }


async def _register_processor(test_app, auth_headers, *, status: str = "available") -> None:
    response = await test_app.put(
        "/api/extensions/capabilities/licensetrack-ai",
        headers=auth_headers,
        json={
            "name": "AI document processor",
            "capabilityType": "document.processing",
            "status": status,
        },
    )
    assert response.status_code == 200, response.text


async def _upload_document(test_app, auth_headers) -> tuple[int, int]:
    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_minimal_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]

    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    return license_id, upload_resp.json()["id"]


async def _create_custom_field(test_app, auth_headers, name: str, field_type: str) -> dict:
    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": name, "fieldType": field_type},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _result_payload(document_id: int) -> dict:
    return {
        "documentType": "license_document",
        "documentId": document_id,
        "capabilityKey": "licensetrack-ai",
        "summary": "Detected entitlement details.",
        "suggestedFields": [
            {
                "field": "quantity",
                "value": "25",
                "confidence": 0.91,
                "source": "Page 1",
                "note": "Seat count found near entitlement table.",
            }
        ],
        "rawOutput": {"model": "example-parser"},
    }


async def test_processor_can_submit_pending_document_processing_result(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)

    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Document processor", "scopes": ["documents:write", "extensions:write"]},
    )
    assert token_resp.status_code == 201, token_resp.text

    response = await test_app.post(
        "/api/document-processing-results",
        headers={"Authorization": f"Bearer {token_resp.json()['token']}"},
        json=_result_payload(document_id),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "pending"
    assert body["licenseId"] == license_id
    assert body["capabilityKey"] == "licensetrack-ai"
    assert body["suggestedFields"][0]["field"] == "quantity"
    assert body["suggestedFields"][0]["confidence"] == 0.91

    stored = await db_session.scalar(select(DocumentProcessingResult).where(DocumentProcessingResult.id == body["id"]))
    assert stored is not None
    assert stored.status == "pending"
    assert stored.suggested_fields[0]["field"] == "quantity"

    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "document_processing_result.created")
    )
    assert audit is not None
    assert audit.target_id == str(body["id"])
    assert "suggestedFields=1" in audit.detail


async def test_new_document_processing_result_supersedes_previous_pending_result(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)

    first_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert first_resp.status_code == 201, first_resp.text

    payload = _result_payload(document_id)
    payload["suggestedFields"][0]["value"] = "40"
    second_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert second_resp.status_code == 201, second_resp.text

    first = await db_session.get(DocumentProcessingResult, first_resp.json()["id"])
    second = await db_session.get(DocumentProcessingResult, second_resp.json()["id"])
    assert first.status == "superseded"
    assert first.reviewed_by == 1
    assert first.reviewed_at is not None
    assert second.status == "pending"

    pending_list = await test_app.get(
        f"/api/document-processing-results?license_id={second.license_id}&status=pending",
        headers=auth_headers,
    )
    assert pending_list.status_code == 200, pending_list.text
    assert [item["id"] for item in pending_list.json()] == [second_resp.json()["id"]]

    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "document_processing_result.superseded")
    )
    assert audit is not None
    assert audit.target_id == str(first.id)


async def test_document_processing_result_requires_available_capability(test_app, auth_headers):
    _, document_id = await _upload_document(test_app, auth_headers)

    response = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "No available document processor extension is registered for this capability"


async def test_document_processing_result_requires_token_scopes(test_app, auth_headers):
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Document writer", "scopes": ["documents:write"]},
    )
    assert token_resp.status_code == 201, token_resp.text

    response = await test_app.post(
        "/api/document-processing-results",
        headers={"Authorization": f"Bearer {token_resp.json()['token']}"},
        json=_result_payload(document_id),
    )

    assert response.status_code == 403
    assert "extensions:write" in response.json()["detail"]


async def test_list_document_processing_results_can_filter_by_license(test_app, auth_headers):
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)

    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    list_resp = await test_app.get(
        f"/api/document-processing-results?license_id={license_id}&status=pending",
        headers=auth_headers,
    )

    assert list_resp.status_code == 200, list_resp.text
    assert [item["id"] for item in list_resp.json()] == [create_resp.json()["id"]]


async def test_accept_document_processing_result_applies_suggested_license_fields(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"]["status"] == "accepted"
    assert body["appliedFields"] == ["quantity"]

    accepted_list = await test_app.get(
        f"/api/document-processing-results?license_id={license_id}&status=accepted",
        headers=auth_headers,
    )
    assert accepted_list.status_code == 200, accepted_list.text
    assert [item["id"] for item in accepted_list.json()] == [create_resp.json()["id"]]

    license_obj = await db_session.get(License, license_id)
    assert license_obj.quantity == "25"
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.reviewed_by == 1
    assert stored.reviewed_at is not None

    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "document_processing_result.accepted")
    )
    assert audit is not None
    assert "mutationType=document_processing_acceptance" in audit.detail
    assert f"resultId={create_resp.json()['id']}" in audit.detail
    assert "documentType=license_document" in audit.detail
    assert "capabilityKey=licensetrack-ai" in audit.detail
    assert "sourceDocument=entitlement.pdf" in audit.detail
    assert "reviewer=" in audit.detail
    assert "appliedFields=quantity" in audit.detail
    assert "quantity: 5 → 25" in audit.detail

    license_audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "license.updated")
    )
    assert license_audit is not None
    assert "mutationType=document_processing_acceptance" in license_audit.detail
    assert f"resultId={create_resp.json()['id']}" in license_audit.detail
    assert "capabilityKey=licensetrack-ai" in license_audit.detail
    assert "sourceDocument=entitlement.pdf" in license_audit.detail
    assert "quantity: 5 → 25" in license_audit.detail


async def test_accept_document_processing_result_can_apply_selected_suggestions(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [
        {"field": "quantity", "value": "30"},
        {"field": "skuCode", "value": "AI-SHOULD-NOT-APPLY"},
    ]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
        json={"suggestedFieldIndexes": [0]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["appliedFields"] == ["quantity"]
    license_obj = await db_session.get(License, license_id)
    assert license_obj.quantity == "30"
    assert license_obj.sku_code == ""


async def test_accept_document_processing_result_rejects_invalid_suggestion_indexes(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
        json={"suggestedFieldIndexes": [7]},
    )

    assert response.status_code == 422
    assert "Invalid suggested field index" in response.json()["detail"]
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.status == "pending"


async def test_reject_document_processing_result_marks_reviewed_without_applying(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/reject",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["result"]["status"] == "rejected"
    assert response.json()["appliedFields"] == []
    license_obj = await db_session.get(License, license_id)
    assert license_obj.quantity == "5"


async def test_accept_document_processing_result_rejects_unknown_fields(test_app, db_session, auth_headers):
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [{"field": "unsupported_magic", "value": "x"}]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert "unsupported_magic" in response.json()["detail"]
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.status == "pending"


async def test_accept_document_processing_result_validates_custom_field_suggestions(
    test_app,
    db_session,
    auth_headers,
):
    await _register_processor(test_app, auth_headers)
    date_def = await _create_custom_field(test_app, auth_headers, "Review Date", "date")
    license_id, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [{"field": "Review Date", "value": "31/12/2026"}]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert "YYYY-MM-DD" in response.json()["detail"]
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.status == "pending"
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_id,
            CustomFieldValue.custom_field_def_id == date_def["id"],
        )
    )
    assert value is None


async def test_accept_document_processing_custom_field_audit_includes_diff(
    test_app,
    db_session,
    auth_headers,
):
    await _register_processor(test_app, auth_headers)
    date_def = await _create_custom_field(test_app, auth_headers, "Review Date", "date")
    license_id, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [{"field": "Review Date", "value": "2026-02-14"}]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["appliedFields"] == [date_def["fieldKey"]]
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_id,
            CustomFieldValue.custom_field_def_id == date_def["id"],
        )
    )
    assert value is not None
    assert value.value_text == "2026-02-14"

    license_audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "license.updated")
    )
    assert license_audit is not None
    assert "mutationType=document_processing_acceptance" in license_audit.detail
    assert "cf_review_date:  → 2026-02-14" in license_audit.detail


async def test_accept_rejects_lifecycle_repair_fields(test_app, db_session, auth_headers):
    """Extension suggestions for lifecycle repair fields must be rejected, not applied."""
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [{"field": "lifecycle_status", "value": "renewed"}]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert "lifecycle_status" in response.json()["detail"]
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.status == "pending"


async def test_accept_lifecycle_and_valid_fields_rejects_atomically(test_app, db_session, auth_headers):
    """When a lifecycle repair field is mixed with a valid field, no field is applied."""
    await _register_processor(test_app, auth_headers)
    license_id, document_id = await _upload_document(test_app, auth_headers)
    payload = _result_payload(document_id)
    payload["suggestedFields"] = [
        {"field": "quantity", "value": "99"},
        {"field": "renewed_from_id", "value": "42"},
    ]
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text

    response = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert "renewed_from_id" in response.json()["detail"]
    license_obj = await db_session.get(License, license_id)
    assert license_obj.quantity == "5"  # unchanged despite valid quantity suggestion
    stored = await db_session.get(DocumentProcessingResult, create_resp.json()["id"])
    assert stored.status == "pending"


async def test_accept_token_with_only_extension_scope_cannot_accept(test_app, auth_headers):
    """An API token scoped to extensions:write alone must not be able to accept results."""
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Extension only", "scopes": ["extensions:write"]},
    )
    assert token_resp.status_code == 201, token_resp.text
    ext_headers = {"Authorization": f"Bearer {token_resp.json()['token']}"}

    accept_resp = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=ext_headers,
    )

    assert accept_resp.status_code == 403


async def test_acceptance_audit_license_updated_contains_full_source_context(
    test_app, db_session, auth_headers
):
    """license.updated emitted by acceptance must carry enough context to reconstruct
    the source without querying document_processing_result."""
    await _register_processor(test_app, auth_headers)
    _, document_id = await _upload_document(test_app, auth_headers)
    create_resp = await test_app.post(
        "/api/document-processing-results",
        headers=auth_headers,
        json=_result_payload(document_id),
    )
    assert create_resp.status_code == 201, create_resp.text

    accept_resp = await test_app.post(
        f"/api/document-processing-results/{create_resp.json()['id']}/accept",
        headers=auth_headers,
    )
    assert accept_resp.status_code == 200, accept_resp.text

    license_audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "license.updated")
    )
    assert license_audit is not None
    detail = license_audit.detail
    # Must be reconstructable without the processing result row
    assert "mutationType=document_processing_acceptance" in detail
    assert f"resultId={create_resp.json()['id']}" in detail
    assert "capabilityKey=licensetrack-ai" in detail
    assert "sourceDocument=entitlement.pdf" in detail
    assert "reviewer=" in detail
    # Field diff present
    assert "→" in detail

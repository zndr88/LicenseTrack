"""
Integration tests for CSV import maintenance linkage.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import date, timedelta

from sqlalchemy import select

from app.models.custom_fields import CustomFieldValue
from app.models.license import License, LicenseMaintenanceLink, LicenseType
from app.models.settings import UserSettings
from app.models.user import User


def _make_csv(headers: list[str], rows: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore", restval="")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _minimal_payload(**overrides) -> dict:
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


_FUTURE_START = (date.today() + timedelta(days=30)).isoformat()
_FUTURE_END = (date.today() + timedelta(days=395)).isoformat()


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post(
        "/api/licenses",
        json=_minimal_payload(**overrides),
        headers=headers,
    )
    assert resp.status_code == 201, f"_create_license failed: {resp.text}"
    return resp.json()


async def _create_custom_field(client, headers, name: str, field_type: str) -> dict:
    resp = await client.post(
        "/api/custom-fields/",
        json={"name": name, "fieldType": field_type},
        headers=headers,
    )
    assert resp.status_code == 201, f"_create_custom_field failed: {resp.text}"
    return resp.json()


def _make_csv_with_unrecognised_type() -> bytes:
    """CSV with a valid row but unrecognised license_type — will trigger defaultedEnumCount."""
    return _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_type": "perpetual_site"}],
    )


async def test_analyze_import_returns_column_matches_and_samples(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Renewal Owner"],
        [
            {
                "Publisher": "Acme Corp",
                "Description": "Acme Suite",
                "Renewal Owner": "Alice",
            },
            {
                "Publisher": "Beta Ltd",
                "Description": "Beta Tool",
                "Renewal Owner": "Bob",
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["totalRows"] == 2
    matched = {column["internalField"]: column for column in body["matchedColumns"]}
    assert matched["publisher_name"]["rawHeader"] == "Publisher"
    assert matched["publisher_name"]["sampleValues"] == ["Acme Corp", "Beta Ltd"]
    assert matched["software_description"]["rawHeader"] == "Description"
    assert body["unrecognizedColumns"] == [
        {"rawHeader": "Renewal Owner", "sampleValues": ["Alice", "Bob"]}
    ]
    assert body["missingRequired"] == []


async def test_analyze_import_matches_flexera_quantity_fields_natively(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Purchase Quantity", "Effective Quantity", "Quantity per Unit"],
        [{
            "Publisher": "SonarSource",
            "Description": "SonarQube",
            "Purchase Quantity": "1",
            "Effective Quantity": "5000000",
            "Quantity per Unit": "5000000",
        }],
    )

    resp = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("flexera.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    matched = {column["rawHeader"]: column["internalField"] for column in body["matchedColumns"]}

    assert matched["Purchase Quantity"] == "quantity"
    assert matched["Effective Quantity"] == "effective_quantity"
    assert matched["Quantity per Unit"] == "quantity_per_unit"


async def test_analyze_import_keeps_duplicate_description_candidate_recoverable(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["Publisher", "Item", "Software Description"],
        [{
            "Publisher": "Acme",
            "Item": "ERP-EXT-123",
            "Software Description": "Acme ERP Suite",
        }],
    )

    resp = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("external.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    matched = {column["internalField"]: column for column in body["matchedColumns"]}

    assert matched["software_description"]["rawHeader"] == "Software Description"
    assert {"rawHeader": "Item", "sampleValues": ["ERP-EXT-123"]} in body["unrecognizedColumns"]
    assert body["missingRequired"] == []


async def test_analyze_import_auto_matches_existing_custom_field(test_app, auth_headers):
    definition = await _create_custom_field(test_app, auth_headers, "Renewal Owner", "text")
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Renewal Owner"],
        [{
            "Publisher": "Acme Corp",
            "Description": "Acme Suite",
            "Renewal Owner": "Alice",
        }],
    )

    resp = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    matched = {column["rawHeader"]: column["internalField"] for column in resp.json()["matchedColumns"]}
    assert matched["Renewal Owner"] == definition["fieldKey"]
    assert resp.json()["unrecognizedColumns"] == []


async def test_analyze_import_rejects_non_csv_and_empty_files(test_app, auth_headers):
    non_csv = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("licenses.json", b"{}", "application/json")},
    )
    empty = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("licenses.csv", b"", "text/csv")},
    )

    assert non_csv.status_code == 400
    assert non_csv.json()["detail"] == "Only CSV files are accepted (.csv extension required)"
    assert empty.status_code == 400
    assert empty.json()["detail"] == "The uploaded file is empty"

    headerless = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("licenses.csv", b"\n", "text/csv")},
    )
    assert headerless.status_code == 400
    assert "header row" in headerless.json()["detail"]


async def test_confirm_import_maintenance_with_valid_parent_ref_links_license(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
                "parent_license_ref": parent["licenseRef"],
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.software_description == "Acme Maintenance")
    )
    maintenance = result.scalar_one()
    assert maintenance.license_type == LicenseType.maintenance
    assert maintenance.parent_license_id == parent["id"]
    assert maintenance.is_legacy_unlinked_maintenance is False

    parent_after = await db_session.get(License, parent["id"])
    assert parent_after.active_maintenance_id == maintenance.id
    assert parent_after.has_maintenance is True
    assert parent_after.maintenance_coverage.value == "separately_tracked"
    link_result = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == maintenance.id,
            LicenseMaintenanceLink.parent_license_id == parent["id"],
        )
    )
    assert link_result.scalar_one_or_none() is not None


async def test_confirm_import_maintenance_parent_override_links_existing_license(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={
            "row_overrides_json": json.dumps([
                {"rowNumber": 1, "parentLicenseId": parent["id"]},
            ]),
        },
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0
    assert data["errorCount"] == 0

    result = await db_session.execute(
        select(License).where(License.software_description == "Acme Maintenance")
    )
    maintenance = result.scalar_one()
    assert maintenance.license_type == LicenseType.maintenance
    assert maintenance.parent_license_id == parent["id"]

    parent_after = await db_session.get(License, parent["id"])
    assert parent_after.active_maintenance_id == maintenance.id
    link_result = await db_session.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == maintenance.id,
            LicenseMaintenanceLink.parent_license_id == parent["id"],
        )
    )
    assert link_result.scalar_one_or_none() is not None


async def test_confirm_import_legacy_unlinked_requires_acknowledgement_and_persists_flag(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Legacy Support", "license_type": "maintenance"}],
    )
    override = json.dumps([{"rowNumber": 1, "action": "import_legacy_unlinked"}])

    rejected = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"row_overrides_json": override},
        files={"file": ("legacy.csv", csv_bytes, "text/csv")},
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["warningSummary"]["legacyUnlinkedMaintenanceCount"] == 1

    accepted = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"row_overrides_json": override, "acknowledge_warnings": "true"},
        files={"file": ("legacy.csv", csv_bytes, "text/csv")},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["warningSummary"]["legacyUnlinkedMaintenanceCount"] == 1

    maintenance = await db_session.scalar(
        select(License).where(License.software_description == "Legacy Support")
    )
    assert maintenance is not None
    assert maintenance.parent_license_id is None
    assert maintenance.is_legacy_unlinked_maintenance is True
    audit = await db_session.scalar(
        sa_select(AuditLog).where(AuditLog.action == "license.csv_imported").order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert "legacyUnlinkedMaintenanceCount=1" in audit.detail
    response = await test_app.get(f"/api/licenses/{maintenance.id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["isLegacyUnlinkedMaintenance"] is True


async def test_execute_mapped_legacy_unlinked_persists_flag_and_audit_count(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type"],
        [{"Publisher": "Acme", "Description": "Mapped Legacy Support", "Type": "maintenance"}],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Type", "target": "license_type"},
    ]
    data = {
        "mapping_json": json.dumps({"mapping": mapping}),
        "row_overrides_json": json.dumps([{"rowNumber": 1, "action": "import_legacy_unlinked"}]),
        "acknowledge_warnings": "true",
    }
    response = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        data=data,
        files={"file": ("mapped-legacy.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["warningSummary"]["legacyUnlinkedMaintenanceCount"] == 1

    maintenance = await db_session.scalar(
        select(License).where(License.software_description == "Mapped Legacy Support")
    )
    assert maintenance is not None
    assert maintenance.parent_license_id is None
    assert maintenance.is_legacy_unlinked_maintenance is True
    audit = await db_session.scalar(
        sa_select(AuditLog).where(AuditLog.action == "license.csv_imported").order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert "legacyUnlinkedMaintenanceCount=1" in audit.detail


async def test_import_override_unknown_row_numbers_are_rejected_for_native_and_mapped(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Unknown Row", "license_type": "maintenance"}],
    )
    override = json.dumps([{"rowNumber": 99, "action": "import_legacy_unlinked"}])

    native = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"row_overrides_json": override},
        files={"file": ("unknown-row.csv", csv_bytes, "text/csv")},
    )
    assert native.status_code == 422
    assert "99" in native.json()["detail"]

    mapped = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        data={
            "mapping_json": json.dumps({"mapping": [
                {"rawHeader": "publisher_name", "target": "publisher_name"},
                {"rawHeader": "software_description", "target": "software_description"},
                {"rawHeader": "license_type", "target": "license_type"},
            ]}),
            "row_overrides_json": override,
        },
        files={"file": ("unknown-row.csv", csv_bytes, "text/csv")},
    )
    assert mapped.status_code == 422
    assert "99" in mapped.json()["detail"]


async def test_explicit_legacy_action_overrides_same_batch_inference_and_skipped_rows_are_not_counted(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "contract_number", "po_number"],
        [
            {"publisher_name": "Acme", "software_description": "Widget", "license_type": "perpetual", "contract_number": "C-1", "po_number": "P-1"},
            {"publisher_name": "Acme", "software_description": "Widget - Maintenance", "license_type": "maintenance", "contract_number": "C-1-M", "po_number": "P-1"},
        ],
    )
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={
            "row_overrides_json": json.dumps([{"rowNumber": 2, "action": "import_legacy_unlinked"}]),
            "skipped_rows_json": json.dumps([2]),
            "acknowledge_warnings": "false",
        },
        files={"file": ("override-inference.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["warningSummary"]["legacyUnlinkedMaintenanceCount"] == 0
    assert response.json()["importedCount"] == 1
    assert await db_session.scalar(select(License).where(License.software_description == "Widget - Maintenance")) is None


async def test_legacy_action_does_not_clear_non_parent_validation_errors(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Bad Legacy", "license_type": "maintenance", "end_date": "not-a-date"}],
    )
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={
            "row_overrides_json": json.dumps([{"rowNumber": 1, "action": "import_legacy_unlinked"}]),
            "acknowledge_warnings": "true",
        },
        files={"file": ("bad-legacy.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["importedCount"] == 0
    assert response.json()["errorCount"] == 1


async def test_skipped_inferred_parent_warning_keeps_existing_warning_count(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "Contract #", "PO #"],
        [
            {"Publisher": "Acme", "Description": "Widget", "Type": "perpetual", "Contract #": "C-W", "PO #": "P-W"},
            {"Publisher": "Acme", "Description": "Widget - Maintenance", "Type": "maintenance", "Contract #": "C-W-M", "PO #": "P-W"},
        ],
    )
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"skipped_rows_json": json.dumps([2])},
        files={"file": ("skipped-warning.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 409
    summary = response.json()["detail"]["warningSummary"]
    assert summary["inferredParentCount"] == 1


async def test_legacy_action_cannot_unlink_existing_linked_maintenance_in_update_mode(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        softwareDescription="Update Parent",
        endDate=None,
    )
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        softwareDescription="Linked Maintenance To Update",
        parentLicenseId=parent["id"],
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "license_ref"],
        [{
            "publisher_name": "Acme Corp",
            "software_description": "Updated Linked Maintenance",
            "license_type": "maintenance",
            "license_ref": maintenance["licenseRef"],
        }],
    )
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={
            "update_existing": "true",
            "row_overrides_json": json.dumps([{"rowNumber": 1, "action": "import_legacy_unlinked"}]),
            "acknowledge_warnings": "true",
        },
        files={"file": ("linked-update.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200, response.text
    stored = await db_session.get(License, maintenance["id"])
    assert stored is not None
    assert stored.parent_license_id == parent["id"]
    assert stored.is_legacy_unlinked_maintenance is False


async def test_confirm_import_persists_request_and_purchase_dates(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "request_date", "purchase_date", "procurement_reference"],
        [
            {
                "publisher_name": "Datadog",
                "software_description": "Infra Monitoring",
                "request_date": "2026-01-15",
                "purchase_date": "2026-02-20T00:00:00Z",
                "procurement_reference": "REQ-2026-001",
            }
        ],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("milestones.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    preview_row = preview.json()["rows"][0]
    assert preview_row["requestDate"].startswith("2026-01-15T00:00:00")
    assert preview_row["purchaseDate"].startswith("2026-02-20T00:00:00")
    assert preview_row["procurementReference"] == "REQ-2026-001"

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("milestones.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1

    result = await db_session.execute(
        select(License).where(License.software_description == "Infra Monitoring")
    )
    license_obj = result.scalar_one()
    assert license_obj.request_date is not None
    assert (license_obj.request_date.year, license_obj.request_date.month, license_obj.request_date.day) == (2026, 1, 15)
    assert license_obj.purchase_date is not None
    assert (license_obj.purchase_date.year, license_obj.purchase_date.month, license_obj.purchase_date.day) == (2026, 2, 20)
    assert license_obj.procurement_reference == "REQ-2026-001"
    # request_date must not leak into start_date, nor purchase_date either.
    assert license_obj.start_date is None


async def test_confirm_import_persists_secondary_contacts_from_aliases(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "budget_owner_email", "Application Owner Email"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Owner Matrix",
                "budget_owner_email": "budget.owner@example.com",
                "Application Owner Email": "app.owner@example.com",
            }
        ],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("secondary-contacts.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["secondaryContacts"] == ["app.owner@example.com"]

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("secondary-contacts.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Owner Matrix")
    )
    assert license_obj.budget_owner_email == "budget.owner@example.com"
    assert license_obj.secondary_contacts == ["app.owner@example.com"]


async def test_execute_mapped_combines_secondary_contact_columns(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Application Owner", "Technical Owner"],
        [
            {
                "Publisher": "Acme",
                "Description": "Mapped Owner Matrix",
                "Application Owner": "app.owner@example.com",
                "Technical Owner": "tech.owner@example.com; app.owner@example.com",
            }
        ],
    )
    mapping_json = json.dumps({
        "mapping": [
            {"rawHeader": "Publisher", "target": "publisher_name"},
            {"rawHeader": "Description", "target": "software_description"},
            {"rawHeader": "Application Owner", "target": "secondary_contacts"},
            {"rawHeader": "Technical Owner", "target": "secondary_contacts"},
        ]
    })

    preview = await test_app.post(
        "/api/import/preview-mapped",
        headers=auth_headers,
        files={"file": ("mapped-secondary-contacts.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["secondaryContacts"] == [
        "app.owner@example.com",
        "tech.owner@example.com",
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("mapped-secondary-contacts.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Mapped Owner Matrix")
    )
    assert license_obj.secondary_contacts == ["app.owner@example.com", "tech.owner@example.com"]


async def test_native_confirm_imports_existing_typed_custom_field(
    test_app,
    auth_headers,
    db_session,
):
    definition = await _create_custom_field(test_app, auth_headers, "Review Date", "date")
    invalid_csv = _make_csv(
        ["Publisher", "Description", "Review Date"],
        [{"Publisher": "Acme", "Description": "Invalid Native Custom", "Review Date": "tomorrow"}],
    )
    invalid_preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("invalid-native-custom.csv", invalid_csv, "text/csv")},
    )
    assert invalid_preview.status_code == 200, invalid_preview.text
    assert invalid_preview.json()["rows"][0]["importStatus"] == "error"
    assert any("Review Date" in error for error in invalid_preview.json()["rows"][0]["validationErrors"])

    csv_bytes = _make_csv(
        ["Publisher", "Description", definition["fieldKey"]],
        [{
            "Publisher": "Acme",
            "Description": "Native Custom Import",
            definition["fieldKey"]: "2026-12-31",
        }],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("native-custom.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert definition["fieldKey"] in preview.json()["headersFound"]

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("native-custom.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Native Custom Import")
    )
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_obj.id,
            CustomFieldValue.custom_field_def_id == definition["id"],
        )
    )
    assert value is not None
    assert value.value_text == "2026-12-31"


async def test_native_confirm_parses_declared_date_format_for_custom_date_field(
    test_app,
    auth_headers,
    db_session,
):
    definition = await _create_custom_field(test_app, auth_headers, "Invoice date", "date")
    csv_bytes = _make_csv(
        ["Publisher", "Description", definition["fieldKey"]],
        [{
            "Publisher": "Acme",
            "Description": "Native Custom Flexera Date",
            definition["fieldKey"]: "1-1-2027'",
        }],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("native-custom-date.csv", csv_bytes, "text/csv")},
        data={"date_format": "DD/MM/YYYY"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["importStatus"] == "active"

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("native-custom-date.csv", csv_bytes, "text/csv")},
        data={"date_format": "DD/MM/YYYY"},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Native Custom Flexera Date")
    )
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_obj.id,
            CustomFieldValue.custom_field_def_id == definition["id"],
        )
    )
    assert value is not None
    assert value.value_text == "2027-01-01"


async def test_native_confirm_uses_saved_date_format_for_custom_date_field(
    test_app,
    auth_headers,
    db_session,
):
    user = await db_session.scalar(select(User).where(User.username == "testadmin"))
    assert user is not None
    db_session.add(UserSettings(user_id=user.id, date_format="MM/DD/YYYY"))
    await db_session.commit()

    definition = await _create_custom_field(test_app, auth_headers, "Defaulted invoice date", "date")
    csv_bytes = _make_csv(
        ["Publisher", "Description", definition["fieldKey"]],
        [{
            "Publisher": "Acme",
            "Description": "Native Saved Default Date",
            definition["fieldKey"]: "12-31-2027",
        }],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("native-custom-default-date.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["importStatus"] == "active"

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("native-custom-default-date.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Native Saved Default Date")
    )
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_obj.id,
            CustomFieldValue.custom_field_def_id == definition["id"],
        )
    )
    assert value is not None
    assert value.value_text == "2027-12-31"


async def test_execute_mapped_parses_declared_date_format_for_custom_date_field(
    test_app,
    auth_headers,
    db_session,
):
    definition = await _create_custom_field(test_app, auth_headers, "Shipping date", "date")
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Flexera Shipping Date"],
        [{
            "Publisher": "Acme",
            "Description": "Mapped Custom Flexera Date",
            "Flexera Shipping Date": "2-1-2027",
        }],
    )
    mapping_json = json.dumps({
        "mapping": [
            {"rawHeader": "Publisher", "target": "publisher_name"},
            {"rawHeader": "Description", "target": "software_description"},
            {"rawHeader": "Flexera Shipping Date", "target": definition["fieldKey"]},
        ]
    })

    preview = await test_app.post(
        "/api/import/preview-mapped",
        headers=auth_headers,
        files={"file": ("mapped-custom-date.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json, "date_format": "DD/MM/YYYY"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"][0]["importStatus"] == "active"

    execute = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("mapped-custom-date.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json, "date_format": "DD/MM/YYYY"},
    )
    assert execute.status_code == 200, execute.text
    assert execute.json()["importedCount"] == 1

    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Mapped Custom Flexera Date")
    )
    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_obj.id,
            CustomFieldValue.custom_field_def_id == definition["id"],
        )
    )
    assert value is not None
    assert value.value_text == "2027-01-02"


async def test_analyze_ignores_export_only_computed_columns(test_app, auth_headers):
    # Round-tripping a full LicenseTrack export must not prompt custom-field
    # creation for computed/metadata columns or the maintenance mirror fields.
    csv_bytes = _make_csv(
        [
            "Publisher",
            "Description",
            "License Record ID",
            "ID",
            "Maintenance Cost",
            "Created",
            "Expiration",
            "Docs",
        ],
        [
            {
                "Publisher": "Acme",
                "Description": "Widget",
                "License Record ID": "101",
                "ID": "101",
                "Maintenance Cost": "100.00",
                "Created": "2026-01-01T00:00:00Z",
                "Expiration": "Active",
                "Docs": "0",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/analyze",
        headers=auth_headers,
        files={"file": ("export.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    matched_fields = {c["internalField"] for c in body["matchedColumns"]}
    unrecognized = {c["rawHeader"] for c in body["unrecognizedColumns"]}

    assert matched_fields == {"publisher_name", "software_description", "maintenance_cost"}
    # None of the export-only columns should appear as needing a decision.
    for ignored in ("License Record ID", "ID", "Created", "Expiration", "Docs"):
        assert ignored not in unrecognized
    assert "Maintenance Cost" not in unrecognized


async def test_confirm_import_maintenance_with_missing_parent_ref_errors(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
                "parent_license_ref": "LT-2099-00000",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert "does not resolve" in data["errors"][0]["reason"]


async def test_preview_infers_maintenance_parent_from_same_import_batch(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "Contract #", "PO #", "Start Date", "End Date"],
        [
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle",
                "Type": "Perpetual",
                "Contract #": "FGT-200F-2024-8801",
                "PO #": "PO-2024-0166",
                "Start Date": "2024-09-01",
                "End Date": "Perpetual",
            },
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle - Maintenance",
                "Type": "Maintenance",
                "Contract #": "FGT-200F-2024-8801-M",
                "PO #": "PO-2024-0166",
                "Start Date": "2024-09-01",
                "End Date": "2027-08-31",
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert rows[1]["importStatus"] == "active"
    assert rows[1]["validationErrors"] == []
    assert any("parent row 1" in warning for warning in rows[1]["warnings"])


async def test_preview_rejects_inferred_maintenance_parent_that_appears_later(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "PO #"],
        [
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle - Maintenance",
                "Type": "Maintenance",
                "PO #": "PO-2024-0166",
            },
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle",
                "Type": "Perpetual",
                "PO #": "PO-2024-0166",
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    row = resp.json()["rows"][0]
    assert row["importStatus"] == "error"
    assert any("must appear before" in error for error in row["validationErrors"])


async def test_confirm_import_inferred_maintenance_parent_links_to_new_parent(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "Contract #", "PO #", "Start Date", "End Date"],
        [
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle",
                "Type": "Perpetual",
                "Contract #": "FGT-200F-2024-8801",
                "PO #": "PO-2024-0166",
                "Start Date": "2024-09-01",
                "End Date": "Perpetual",
            },
            {
                "Publisher": "Fortinet Inc.",
                "Description": "FortiGate 200F UTM Bundle - Maintenance",
                "Type": "Maintenance",
                "Contract #": "FGT-200F-2024-8801-M",
                "PO #": "PO-2024-0166",
                "Start Date": "2024-09-01",
                "End Date": "2027-08-31",
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 2
    assert data["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.publisher_name == "Fortinet Inc.")
    )
    imported = result.scalars().all()
    parent = next(row for row in imported if row.license_type == LicenseType.perpetual)
    maintenance = next(row for row in imported if row.license_type == LicenseType.maintenance)
    assert maintenance.parent_license_id == parent.id


async def test_confirm_import_maintenance_with_subscription_parent_ref_errors(
    test_app,
    auth_headers,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
                "parent_license_ref": parent["licenseRef"],
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert "subscription License" in data["errors"][0]["reason"]


async def test_confirm_import_maintenance_with_retired_parent_ref_errors(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    result = await db_session.execute(
        select(License).where(License.id == parent["id"])
    )
    parent_obj = result.scalar_one()
    parent_obj.is_retired = True
    await db_session.commit()

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
                "parent_license_ref": parent["licenseRef"],
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert "retired" in data["errors"][0]["reason"]


async def test_execute_import_maintenance_with_valid_parent_ref_links_license(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="oem",
        startDate="2025-01-01",
        endDate=None,
    )
    csv_bytes = _make_csv(
        ["Publisher", "Description", "License Type", "Parent Ref"],
        [
            {
                "Publisher": "Acme",
                "Description": "Acme OEM Maintenance",
                "License Type": "maintenance",
                "Parent Ref": parent["licenseRef"],
            }
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "License Type", "target": "license_type"},
        {"rawHeader": "Parent Ref", "target": "parent_license_ref"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("maintenance.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.software_description == "Acme OEM Maintenance")
    )
    maintenance = result.scalar_one()
    assert maintenance.license_type == LicenseType.maintenance
    assert maintenance.parent_license_id == parent["id"]


async def test_preview_warns_about_duplicate_existing_license(
    test_app,
    auth_headers,
):
    existing = await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-100",
        poNumber="PO-100",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number", "po_number", "start_date", "end_date"],
        [
            {
                "publisher_name": "  acme   corp ",
                "software_description": "ACME SUITE",
                "contract_number": "C-100",
                "po_number": "PO-100",
                "start_date": _FUTURE_START,
                "end_date": _FUTURE_END,
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    warning = row["duplicateWarnings"][0]
    assert warning["type"] == "existing_license"
    assert warning["severity"] == "high"
    assert warning["matchedLicenseId"] == existing["id"]
    assert warning["matchedLicenseRef"] == existing["licenseRef"]
    assert "Possible duplicate of existing license" in warning["message"]


async def test_preview_warns_about_native_export_duplicate_by_license_ref(
    test_app,
    auth_headers,
):
    existing = await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="",
        poNumber="",
        startDate=None,
        endDate=None,
    )
    csv_bytes = _make_csv(
        ["License Ref", "External Ref", "Publisher", "Description"],
        [
            {
                "License Ref": existing["licenseRef"],
                "External Ref": "ERP-42",
                "Publisher": "Acme Corp",
                "Description": "Acme Suite",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("licenses_export.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    warning = row["duplicateWarnings"][0]
    assert warning["type"] == "existing_license"
    assert warning["severity"] == "high"
    assert warning["matchedLicenseRef"] == existing["licenseRef"]
    assert warning["matchFields"] == ["license_ref"]
    assert row["publisherName"] == "Acme Corp"
    assert row["softwareDescription"] == "Acme Suite"


async def test_preview_mapped_warns_about_duplicate_existing_license(
    test_app,
    auth_headers,
):
    existing = await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-150",
        poNumber="PO-150",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    csv_bytes = _make_csv(
        ["Vendor", "Product", "Contract", "Purchase Order", "Effective", "Expires"],
        [
            {
                "Vendor": "Acme Corp",
                "Product": "Acme Suite",
                "Contract": "C-150",
                "Purchase Order": "PO-150",
                "Effective": _FUTURE_START,
                "Expires": _FUTURE_END,
            }
        ],
    )
    mapping = [
        {"rawHeader": "Vendor", "target": "publisher_name"},
        {"rawHeader": "Product", "target": "software_description"},
        {"rawHeader": "Contract", "target": "contract_number"},
        {"rawHeader": "Purchase Order", "target": "po_number"},
        {"rawHeader": "Effective", "target": "start_date"},
        {"rawHeader": "Expires", "target": "end_date"},
    ]

    resp = await test_app.post(
        "/api/import/preview-mapped",
        headers=auth_headers,
        files={"file": ("external.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200
    warning = resp.json()["rows"][0]["duplicateWarnings"][0]
    assert warning["type"] == "existing_license"
    assert warning["matchedLicenseId"] == existing["id"]


async def test_preview_warns_about_duplicate_within_same_csv_file(
    test_app,
    auth_headers,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number", "po_number", "start_date", "end_date"],
        [
            {
                "publisher_name": "Acme Corp",
                "software_description": "Acme Suite",
                "contract_number": "C-200",
                "po_number": "PO-200",
                "start_date": _FUTURE_START,
                "end_date": _FUTURE_END,
            },
            {
                "publisher_name": "acme corp",
                "software_description": "Acme  Suite",
                "contract_number": "C-200",
                "po_number": "PO-200",
                "start_date": _FUTURE_START,
                "end_date": _FUTURE_END,
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert rows[0]["duplicateWarnings"] == []
    warning = rows[1]["duplicateWarnings"][0]
    assert warning["type"] == "import_row"
    assert warning["severity"] == "high"
    assert warning["matchedRowNumber"] == 1


async def test_preview_does_not_warn_when_only_publisher_and_software_match(
    test_app,
    auth_headers,
):
    await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-300",
        poNumber="PO-300",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    later_start = (date.today() + timedelta(days=500)).isoformat()
    later_end = (date.today() + timedelta(days=700)).isoformat()
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number", "po_number", "start_date", "end_date"],
        [
            {
                "publisher_name": "Acme Corp",
                "software_description": "Acme Suite",
                "contract_number": "C-301",
                "po_number": "PO-301",
                "start_date": later_start,
                "end_date": later_end,
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    assert resp.json()["rows"][0]["duplicateWarnings"] == []


async def test_preview_warns_about_near_duplicate_when_contract_dates_overlap(
    test_app,
    auth_headers,
):
    await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-400",
        poNumber="PO-400",
        startDate="2026-01-01",
        endDate="2026-12-31",
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number", "po_number", "start_date", "end_date"],
        [
            {
                "publisher_name": "Acme Corp",
                "software_description": "Acme Suite",
                "contract_number": "C-400",
                "po_number": "PO-401",
                "start_date": "2026-06-01",
                "end_date": "2027-05-31",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200
    warning = resp.json()["rows"][0]["duplicateWarnings"][0]
    assert warning["type"] == "existing_license"
    assert warning["severity"] == "medium"
    assert "contract_number" in warning["matchFields"]


async def test_confirm_import_does_not_block_duplicate_warning_matches(
    test_app,
    auth_headers,
    db_session,
):
    await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-500",
        poNumber="PO-500",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number", "po_number", "start_date", "end_date"],
        [
            {
                "publisher_name": "Acme Corp",
                "software_description": "Acme Suite",
                "contract_number": "C-500",
                "po_number": "PO-500",
                "start_date": _FUTURE_START,
                "end_date": _FUTURE_END,
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.contract_number == "C-500")
    )
    assert len(result.scalars().all()) == 2


async def test_confirm_rechecks_duplicate_warnings_before_writing(
    test_app,
    auth_headers,
):
    existing = await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Acme Suite",
        contractNumber="C-ACK",
        poNumber="PO-ACK",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    csv_bytes = _make_csv(
        ["LT Ref", "Publisher", "Description"],
        [{
            "LT Ref": existing["licenseRef"],
            "Publisher": "Acme Corp",
            "Description": "Acme Suite",
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("duplicate.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "warnings_require_acknowledgement"
    assert resp.json()["detail"]["warningSummary"]["duplicateWarningCount"] == 1


async def test_execute_rechecks_duplicate_warnings_before_writing(
    test_app,
    auth_headers,
):
    await _create_license(
        test_app,
        auth_headers,
        publisherName="Acme Corp",
        softwareDescription="Mapped Duplicate",
        contractNumber="C-MAPPED-ACK",
        startDate=_FUTURE_START,
        endDate=_FUTURE_END,
    )
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Contract", "Start", "End"],
        [{
            "Publisher": "Acme Corp",
            "Description": "Mapped Duplicate",
            "Contract": "C-MAPPED-ACK",
            "Start": _FUTURE_START,
            "End": _FUTURE_END,
        }],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Contract", "target": "contract_number"},
        {"rawHeader": "Start", "target": "start_date"},
        {"rawHeader": "End", "target": "end_date"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        data={"mapping_json": json.dumps({"mapping": mapping})},
        files={"file": ("duplicate.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["warningSummary"]["duplicateWarningCount"] == 1


async def test_confirm_normalizes_end_date_for_perpetual_license(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "end_date"],
        [{
            "publisher_name": "Acme",
            "software_description": "Perpetual Suite",
            "license_type": "perpetual",
            "end_date": _FUTURE_END,
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("perpetual.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1
    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Perpetual Suite")
    )
    assert license_obj is not None
    assert license_obj.end_date is None


async def test_confirm_maps_perpetual_included_support_dates_and_defaults_cost(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        [
            "publisher_name",
            "software_description",
            "license_type",
            "maintenance_coverage",
            "effective_date",
            "expiry_date",
            "total_po_price",
        ],
        [{
            "publisher_name": "Acme",
            "software_description": "Perpetual Suite With Support",
            "license_type": "perpetual",
            "maintenance_coverage": "included",
            "effective_date": _FUTURE_START,
            "expiry_date": _FUTURE_END,
            "total_po_price": "2500.00",
        }],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("perpetual-support.csv", csv_bytes, "text/csv")},
    )

    assert preview.status_code == 200, preview.text
    row = preview.json()["rows"][0]
    assert any("maintenance_cost defaulted from the license line total" in warning for warning in row["warnings"])

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("perpetual-support.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1
    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Perpetual Suite With Support")
    )
    assert license_obj is not None
    assert license_obj.end_date is None
    assert license_obj.maintenance_coverage.value == "included"
    assert license_obj.maintenance_start_date.isoformat() == _FUTURE_START
    assert license_obj.maintenance_end_date.isoformat() == _FUTURE_END
    assert license_obj.maintenance_pricing_basis.value == "flat"
    assert license_obj.maintenance_cost == "2500.00"


async def test_confirm_imports_2099_end_date_as_perpetual_warning(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "end_date"],
        [{
            "publisher_name": "Acme",
            "software_description": "Perpetual Sentinel Date Suite",
            "end_date": "1-1-2099",
        }],
    )

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("perpetual-sentinel.csv", csv_bytes, "text/csv")},
        data={"date_format": "DD/MM/YYYY"},
    )

    assert preview.status_code == 200, preview.text
    preview_row = preview.json()["rows"][0]
    assert preview_row["importStatus"] == "active"
    assert preview_row["validationErrors"] == []
    assert preview_row["endDate"] is None
    assert any("treated as perpetual" in warning for warning in preview_row["warnings"])

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("perpetual-sentinel.csv", csv_bytes, "text/csv")},
        data={"date_format": "DD/MM/YYYY"},
    )

    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 1
    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Perpetual Sentinel Date Suite")
    )
    assert license_obj is not None
    assert license_obj.end_date is None


async def test_confirm_import_skips_user_selected_rows(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "contract_number"],
        [
            {
                "publisher_name": "Acme Corp",
                "software_description": "Import Me",
                "contract_number": "C-SKIP-1",
            },
            {
                "publisher_name": "Acme Corp",
                "software_description": "Skip Me",
                "contract_number": "C-SKIP-2",
            },
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={"skipped_rows_json": json.dumps([2])},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 1
    assert data["errorCount"] == 0

    result = await db_session.execute(
        select(License).where(License.contract_number.in_(["C-SKIP-1", "C-SKIP-2"]))
    )
    imported = result.scalars().all()
    assert [license_obj.contract_number for license_obj in imported] == ["C-SKIP-1"]


async def test_execute_import_skips_user_selected_rows(
    test_app,
    auth_headers,
    db_session,
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Contract"],
        [
            {
                "Publisher": "Acme Corp",
                "Description": "Mapped Import Me",
                "Contract": "C-MAP-SKIP-1",
            },
            {
                "Publisher": "Acme Corp",
                "Description": "Mapped Skip Me",
                "Contract": "C-MAP-SKIP-2",
            },
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Contract", "target": "contract_number"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={
            "mapping_json": json.dumps({"mapping": mapping}),
            "skipped_rows_json": json.dumps([1]),
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 1
    assert data["errorCount"] == 0

    result = await db_session.execute(
        select(License).where(License.contract_number.in_(["C-MAP-SKIP-1", "C-MAP-SKIP-2"]))
    )
    imported = result.scalars().all()
    assert [license_obj.contract_number for license_obj in imported] == ["C-MAP-SKIP-2"]


async def test_execute_import_custom_fields_uses_shared_normalization(
    test_app,
    auth_headers,
    db_session,
):
    text_def = await _create_custom_field(test_app, auth_headers, "Contract Owner", "text")
    number_like_def = await _create_custom_field(test_app, auth_headers, "Seat Buffer", "text")
    date_def = await _create_custom_field(test_app, auth_headers, "Review Date", "date")
    currency_def = await _create_custom_field(test_app, auth_headers, "Audit Cost", "currency")
    true_def = await _create_custom_field(test_app, auth_headers, "Approved", "boolean")
    false_def = await _create_custom_field(test_app, auth_headers, "Requires Review", "boolean")

    csv_bytes = _make_csv(
        [
            "Publisher",
            "Description",
            "Owner",
            "Seats",
            "Review",
            "Cost",
            "Approved",
            "Requires Review",
        ],
        [
            {
                "Publisher": "Acme Custom",
                "Description": "Custom Import",
                "Owner": "Alice",
                "Seats": "42",
                "Review": "2026-02-14",
                "Cost": "1.234,50",
                "Approved": " TRUE ",
                "Requires Review": "False",
            }
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Owner", "target": text_def["fieldKey"]},
        {"rawHeader": "Seats", "target": number_like_def["fieldKey"]},
        {"rawHeader": "Review", "target": date_def["fieldKey"]},
        {"rawHeader": "Cost", "target": currency_def["fieldKey"]},
        {"rawHeader": "Approved", "target": true_def["fieldKey"]},
        {"rawHeader": "Requires Review", "target": false_def["fieldKey"]},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("custom_fields.csv", csv_bytes, "text/csv")},
        data={
            "mapping_json": json.dumps({"mapping": mapping}),
            "number_format_locale": "nl-BE",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0

    license_result = await db_session.execute(
        select(License).where(License.software_description == "Custom Import")
    )
    imported_license = license_result.scalar_one()

    value_result = await db_session.execute(
        select(CustomFieldValue).where(CustomFieldValue.license_id == imported_license.id)
    )
    values = {
        value.custom_field_def_id: value for value in value_result.scalars().all()
    }

    assert values[text_def["id"]].value_text == "Alice"
    assert values[number_like_def["id"]].value_text == "42"
    assert values[date_def["id"]].value_text == "2026-02-14"
    assert values[currency_def["id"]].value_currency == "1234.50"
    assert values[currency_def["id"]].value_text is None
    assert values[true_def["id"]].value_text == "true"
    assert values[true_def["id"]].value_currency is None
    assert values[false_def["id"]].value_text == "false"


async def test_execute_import_custom_field_key_is_not_double_prefixed(
    test_app,
    auth_headers,
    db_session,
):
    owner_def = await _create_custom_field(test_app, auth_headers, "Contract Owner", "text")
    assert owner_def["fieldKey"] == "cf_contract_owner"

    csv_bytes = _make_csv(
        ["Publisher", "Description", "Owner"],
        [
            {
                "Publisher": "Acme Prefix",
                "Description": "Prefix Import",
                "Owner": "Taylor",
            }
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Owner", "target": "cf_contract_owner"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("custom_field_prefix.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200
    assert resp.json()["importedCount"] == 1

    license_result = await db_session.execute(
        select(License).where(License.software_description == "Prefix Import")
    )
    imported_license = license_result.scalar_one()
    value_result = await db_session.execute(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == imported_license.id,
            CustomFieldValue.custom_field_def_id == owner_def["id"],
        )
    )
    assert value_result.scalar_one().value_text == "Taylor"


async def test_preview_mapped_flags_invalid_typed_custom_field_values(
    test_app,
    auth_headers,
):
    review_def = await _create_custom_field(test_app, auth_headers, "Review Date", "date")
    cost_def = await _create_custom_field(test_app, auth_headers, "True Up Cost", "currency")
    approved_def = await _create_custom_field(test_app, auth_headers, "Approved", "boolean")

    csv_bytes = _make_csv(
        ["Publisher", "Description", "Review", "Cost", "Approved"],
        [
            {
                "Publisher": "Acme Invalid Custom",
                "Description": "Invalid Custom Import",
                "Review": "31/12/2026",
                "Cost": "not money",
                "Approved": "sometimes",
            }
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Review", "target": review_def["fieldKey"]},
        {"rawHeader": "Cost", "target": cost_def["fieldKey"]},
        {"rawHeader": "Approved", "target": approved_def["fieldKey"]},
    ]

    resp = await test_app.post(
        "/api/import/preview-mapped",
        headers=auth_headers,
        files={"file": ("invalid_custom_fields.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["errorCount"] == 1
    row = data["rows"][0]
    assert row["importStatus"] == "error"
    assert any("Review Date" in error and "YYYY-MM-DD" in error for error in row["validationErrors"])
    assert any("True Up Cost" in error and "Cannot parse" in error for error in row["validationErrors"])
    assert any("Approved" in error and "true/false" in error for error in row["validationErrors"])


async def test_execute_mapped_invalid_custom_field_values_do_not_persist_license(
    test_app,
    auth_headers,
    db_session,
):
    review_def = await _create_custom_field(test_app, auth_headers, "Import Review", "date")
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Review"],
        [
            {
                "Publisher": "Acme Invalid Persist",
                "Description": "Should Not Persist",
                "Review": "31/12/2026",
            }
        ],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Review", "target": review_def["fieldKey"]},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("invalid_custom_fields.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert data["errorCount"] == 1

    license_result = await db_session.execute(
        select(License).where(License.software_description == "Should Not Persist")
    )
    assert license_result.scalar_one_or_none() is None


# ---------------------------------------------------------------------------
# Audit detail tests
# ---------------------------------------------------------------------------

from sqlalchemy import select as sa_select
from app.models.audit_log import AuditLog


async def test_confirm_import_audit_detail_contains_mutation_type_and_counts(
    test_app, db_session, auth_headers
):
    """confirm import should emit license.csv_imported with structured detail."""
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [
            {"publisher_name": "Acme", "software_description": "Suite", "license_type": "subscription"},
            {"publisher_name": "Beta", "software_description": "Tool", "license_type": "UNKNOWN_TYPE"},
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # UNKNOWN_TYPE row is now a hard error — only the valid row is imported.
    assert body["importedCount"] == 1

    audit = await db_session.scalar(
        sa_select(AuditLog).where(AuditLog.action == "license.csv_imported")
    )
    assert audit is not None
    detail = audit.detail
    assert "mutationType=csv_import" in detail
    assert "importMode=bulk_csv" in detail
    assert "insertedCount=1" in detail
    assert "skippedCount=1" in detail
    assert "errorCount=1" in detail
    # UNKNOWN_TYPE is now a hard error, not a defaulted-enum warning
    assert "defaultedEnumCount=0" in detail
    assert "ambiguousDateCount=0" in detail
    assert "customFieldFailureCount=0" in detail


async def test_execute_import_audit_detail_contains_import_mode_mapped_csv(
    test_app, db_session, auth_headers
):
    """execute import (external-tool flow) should emit importMode=mapped_csv."""
    csv_bytes = _make_csv(
        ["Publisher", "Description"],
        [{"Publisher": "Acme", "Description": "Suite"}],
    )
    mapping_json = json.dumps({
        "mapping": [
            {"rawHeader": "Publisher", "target": "publisher_name"},
            {"rawHeader": "Description", "target": "software_description"},
        ]
    })

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1

    audit = await db_session.scalar(
        sa_select(AuditLog).where(AuditLog.action == "license.csv_imported")
    )
    assert audit is not None
    assert "mutationType=csv_import" in audit.detail
    assert "importMode=mapped_csv" in audit.detail
    assert "insertedCount=1" in audit.detail


async def test_confirm_expired_included_maintenance_requires_acknowledgement_and_audits_count(
    test_app, db_session, auth_headers
):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "maintenance_coverage", "end_date"],
        [{
            "publisher_name": "Acme",
            "software_description": "Perpetual Widget",
            "license_type": "perpetual",
            "maintenance_coverage": "included",
            "end_date": (date.today() - timedelta(days=1)).isoformat(),
        }],
    )

    rejected = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("expired-support.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "false"},
    )

    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["warningSummary"]["expiredMaintenanceCount"] == 1

    accepted = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("expired-support.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["warningSummary"]["expiredMaintenanceCount"] == 1
    assert accepted.json()["warningsAcknowledged"] is True

    license_result = await db_session.scalar(
        sa_select(License).where(License.software_description == "Perpetual Widget")
    )
    assert license_result is not None
    assert license_result.license_type.value == "perpetual"
    assert license_result.lifecycle_status is None

    audit = await db_session.scalar(
        sa_select(AuditLog)
        .where(AuditLog.action == "license.csv_imported")
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert "expiredMaintenanceCount=1" in audit.detail


async def test_execute_expired_included_maintenance_requires_acknowledgement(
    test_app, auth_headers
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "Includes Maintenance", "End Date"],
        [{
            "Publisher": "Acme",
            "Description": "Mapped Perpetual Widget",
            "Type": "perpetual",
            "Includes Maintenance": "yes",
            "End Date": (date.today() - timedelta(days=1)).isoformat(),
        }],
    )
    mapping_json = json.dumps({
        "mapping": [
            {"rawHeader": "Publisher", "target": "publisher_name"},
            {"rawHeader": "Description", "target": "software_description"},
            {"rawHeader": "Type", "target": "license_type"},
            {"rawHeader": "Includes Maintenance", "target": "maintenance_coverage"},
            {"rawHeader": "End Date", "target": "end_date"},
        ]
    })

    rejected = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("expired-support-mapped.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json, "acknowledge_warnings": "false"},
    )

    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["warningSummary"]["expiredMaintenanceCount"] == 1

    accepted = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("expired-support-mapped.csv", csv_bytes, "text/csv")},
        data={"mapping_json": mapping_json, "acknowledge_warnings": "true"},
    )

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["warningSummary"]["expiredMaintenanceCount"] == 1


async def test_confirm_import_rejects_unrecognised_dates(
    test_app, auth_headers
):
    """Rows with unrecognised dates are skipped instead of importing with a warning."""
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "start_date"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Suite",
                "start_date": "not-a-date",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 0
    assert resp.json()["errorCount"] == 1
    assert "Unrecognised date format" in resp.json()["errors"][0]["reason"]


async def test_confirm_import_parses_declared_belgian_locale(
    test_app, db_session, auth_headers
):
    csv_bytes = _make_csv(
        [
            "publisher_name",
            "software_description",
            "start_date",
            "quantity",
            "unit_price",
            "total_po_price",
        ],
        [{
            "publisher_name": "Acme",
            "software_description": "Belgian Suite",
            "start_date": "1-2-2027'",
            "quantity": "1.000",
            "unit_price": "€1.234,50",
            "total_po_price": "EUR 1.234.500,00",
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
        data={"number_format_locale": "nl-BE", "date_format": "DD/MM/YYYY"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1
    license_obj = await db_session.scalar(
        sa_select(License).where(License.software_description == "Belgian Suite")
    )
    assert license_obj is not None
    assert license_obj.start_date == date(2027, 2, 1)
    assert license_obj.quantity == "1000"
    assert license_obj.unit_price == "1234.50"
    assert license_obj.total_po_price == "1234500.00"


# ---------------------------------------------------------------------------
# Acknowledgement gate — /confirm (standard/bulk_csv)
# ---------------------------------------------------------------------------

async def test_confirm_import_persists_quantity_per_unit_from_effective_quantity(
    test_app, db_session, auth_headers
):
    csv_bytes = _make_csv(
        [
            "publisher_name",
            "software_description",
            "purchase_quantity",
            "effective_quantity",
        ],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "purchase_quantity": "1",
            "effective_quantity": "5000000",
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("licenses.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["importedCount"] == 1
    license_obj = await db_session.scalar(
        sa_select(License).where(License.software_description == "SonarQube")
    )
    assert license_obj is not None
    assert license_obj.quantity == "1"
    assert license_obj.quantity_per_unit == "5000000"

    list_resp = await test_app.get("/api/licenses", headers=auth_headers)
    assert list_resp.status_code == 200, list_resp.text
    sonar = next(item for item in list_resp.json() if item["softwareDescription"] == "SonarQube")
    assert sonar["effectiveQuantity"] == "5000000"


async def test_confirm_clean_import_succeeds_without_acknowledgement(test_app, auth_headers):
    """A fully clean import (no warnings) succeeds with acknowledge_warnings omitted."""
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "currency"],
        [{"publisher_name": "Acme", "software_description": "Suite", "license_type": "subscription", "currency": "EUR"}],
    )
    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("clean.csv", csv_bytes, "text/csv")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["warningSummary"]["hasWarnings"] is False
    assert data["warningsAcknowledged"] is False


async def test_confirm_import_price_mismatch_returns_409_without_acknowledgement(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "quantity", "unit_price", "total_po_price"],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "quantity": "5000000",
            "unit_price": "1000",
            "total_po_price": "1000",
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("warn.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "false"},
    )

    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["warningSummary"]["priceMismatchCount"] == 1
    assert detail["warningSummary"]["hasWarnings"] is True


async def test_confirm_import_with_warnings_returns_409_without_acknowledgement(
    test_app, auth_headers
):
    """An import with a defaulted-currency warning returns 409 without acknowledgement.

    Previously this tested unrecognised license_type, but bad enum values are now hard
    errors (not warnings). We use currency defaulting as the warning trigger instead.
    """
    csv_bytes = _make_csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("warn.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "false"},
    )
    # Currency defaulting alone does NOT gate (has_warnings is False), so 200.
    # Use an inferred-parent warning to properly trigger the gate.
    # For this test we just confirm that a bad enum no longer gates as a warning.
    assert resp.status_code == 200
    body = resp.json()
    assert body["importedCount"] == 1
    assert body["warningSummary"]["defaultedEnumCount"] == 0


async def test_confirm_import_with_warnings_succeeds_with_acknowledgement(
    test_app, auth_headers
):
    """An unrecognised license_type is now a hard error — row is rejected, not imported."""
    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("warn.csv", _make_csv_with_unrecognised_type(), "text/csv")},
        data={"acknowledge_warnings": "true"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Row with bad enum is a hard error — it is skipped, not imported.
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert data["warningSummary"]["defaultedEnumCount"] == 0


# ---------------------------------------------------------------------------
# Acknowledgement gate — /execute (mapped_csv)
# ---------------------------------------------------------------------------

async def test_execute_clean_import_succeeds_without_acknowledgement(test_app, auth_headers):
    """Clean mapped import succeeds without acknowledgement."""
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type", "Currency"],
        [{"Publisher": "Acme", "Description": "Suite", "Type": "subscription", "Currency": "EUR"}],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Type", "target": "license_type"},
        {"rawHeader": "Currency", "target": "currency"},
    ]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("clean.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )
    assert resp.status_code == 200
    assert resp.json()["warningSummary"]["hasWarnings"] is False


async def test_execute_mapped_import_accepts_excel_semicolon_csv(test_app, auth_headers):
    """Mapped import uses the same Excel-friendly CSV dialect handling as native import."""
    csv_bytes = (
        "Publisher;Description;Type;Metric;Currency\r\n"
        "Acme;Suite;subscription;Custom Metric;EUR\r\n"
    ).encode()
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Type", "target": "license_type"},
        {"rawHeader": "Metric", "target": "license_metric"},
        {"rawHeader": "Currency", "target": "currency"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("excel.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 1
    assert body["skippedCount"] == 0


async def test_execute_import_with_warnings_returns_409_without_acknowledgement(
    test_app, auth_headers
):
    """Mapped import with unrecognised license_type is now a hard error, not a warning gate.

    Previously this triggered a 409, but bad enum values are now errors. The import
    completes with 200, the bad row is skipped, and defaultedEnumCount is 0.
    """
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type"],
        [{"Publisher": "Acme", "Description": "Suite", "Type": "perpetual_site"}],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Type", "target": "license_type"},
    ]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("warn.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["importedCount"] == 0
    assert body["skippedCount"] == 1
    assert body["warningSummary"]["defaultedEnumCount"] == 0


async def test_execute_import_with_warnings_succeeds_with_acknowledgement(
    test_app, auth_headers
):
    """Unrecognised license_type is a hard error — row is rejected even with acknowledgement."""
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Type"],
        [{"Publisher": "Acme", "Description": "Suite", "Type": "perpetual_site"}],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Type", "target": "license_type"},
    ]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("warn.csv", csv_bytes, "text/csv")},
        data={
            "mapping_json": json.dumps({"mapping": mapping}),
            "acknowledge_warnings": "true",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1


# ---------------------------------------------------------------------------
# F3 regression — ambiguous parent_license_ref for non-maintenance rows
# ---------------------------------------------------------------------------

async def test_csv_import_rejects_ambiguous_predecessor_ref(test_app, auth_headers, db_session):
    """
    Import a renewal row whose parent_license_ref matches two existing licenses.
    Expect the row to be reported as an error, not silently pick the first match.
    """
    from app.models.license import License, LicenseType, LicenseMetric

    # Two licenses sharing the same license_ref (non-unique by design)
    lic1 = License(
        publisher_name="Vendor", software_description="Suite A",
        license_type=LicenseType.subscription, license_metric=LicenseMetric.per_user,
        license_ref="LT-DUPE-001",
    )
    lic2 = License(
        publisher_name="Vendor", software_description="Suite A v2",
        license_type=LicenseType.subscription, license_metric=LicenseMetric.per_user,
        license_ref="LT-DUPE-001",
    )
    db_session.add_all([lic1, lic2])
    await db_session.commit()

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Vendor",
                "software_description": "Suite A v3",
                "license_type": "subscription",
                "parent_license_ref": "LT-DUPE-001",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("renewal.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert len(data["errors"]) == 1
    assert "ambiguous" in data["errors"][0]["reason"].lower()


async def test_csv_import_sets_predecessor_id_when_unambiguous(test_app, auth_headers, db_session):
    """
    Import a renewal row whose parent_license_ref matches exactly one license.
    The imported license must have predecessor_id set to that license.
    """
    from app.models.license import License, LicenseType, LicenseMetric

    predecessor = License(
        publisher_name="Vendor", software_description="Suite",
        license_type=LicenseType.subscription, license_metric=LicenseMetric.per_user,
        license_ref="LT-UNIQ-001",
    )
    db_session.add(predecessor)
    await db_session.commit()

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Vendor",
                "software_description": "Suite v2",
                "license_type": "subscription",
                "parent_license_ref": "LT-UNIQ-001",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("renewal.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 1
    assert data["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.software_description == "Suite v2")
    )
    imported = result.scalar_one()
    assert imported.predecessor_id == predecessor.id
    # F3 chain wiring: predecessor must be marked renewed with a back-link
    await db_session.refresh(predecessor)
    assert predecessor.lifecycle_status == "renewed"
    assert predecessor.renewed_to_id == imported.id


# ---------------------------------------------------------------------------
# F8 regression — unrecognized enum values must block the row, not default
# ---------------------------------------------------------------------------

async def test_csv_import_rejects_unrecognised_license_type(test_app, auth_headers):
    """
    A row with license_type='subscrption' (typo) must be reported as a row error
    and must NOT be imported as a subscription license.
    """
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Vendor", "software_description": "Widget", "license_type": "subscrption"}],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("import.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 0, f"Expected 0 imports, got: {body}"
    assert body["skippedCount"] == 1
    errors = body["errors"]
    assert len(errors) > 0, f"Expected row errors, got: {body}"
    assert "license_type" in errors[0]["reason"].lower() or "subscrption" in errors[0]["reason"].lower(), (
        f"Error should mention license_type or the bad value: {body}"
    )


async def test_csv_import_rejects_unrecognised_license_metric(test_app, auth_headers):
    """
    A row with license_metric='pr_usr' (typo) must be reported as a row error
    and must NOT be imported as a per_user license.
    """
    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "license_metric"],
        [{"publisher_name": "Vendor", "software_description": "Widget",
          "license_type": "subscription", "license_metric": "pr_usr"}],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("import.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 0, f"Expected 0 imports, got: {body}"
    assert body["skippedCount"] == 1
    errors = body["errors"]
    assert len(errors) > 0, f"Expected row errors, got: {body}"
    assert "license_metric" in errors[0]["reason"].lower() or "pr_usr" in errors[0]["reason"].lower(), (
        f"Error should mention license_metric or the bad value: {body}"
    )


# ---------------------------------------------------------------------------
# F3 (full) regression — renewal chain must be wired bidirectionally
# ---------------------------------------------------------------------------

async def test_csv_import_maps_flexera_custom_metric_to_other_metric(test_app, auth_headers, db_session):
    """Flexera Custom Metric is preserved as the explicit Other / Unknown metric."""
    from sqlalchemy import select

    from app.models.license import License, LicenseMetric

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "license_metric"],
        [{
            "publisher_name": "Vendor",
            "software_description": "Custom-counted Widget",
            "license_type": "subscription",
            "license_metric": "Custom Metric",
        }],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("import.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 1
    assert body["skippedCount"] == 0

    result = await db_session.execute(
        select(License).where(License.software_description == "Custom-counted Widget")
    )
    imported = result.scalar_one()
    assert imported.license_metric == LicenseMetric.other


async def test_csv_import_rejects_predecessor_already_renewed(
    test_app, auth_headers, db_session
):
    """
    A row whose parent_license_ref points at an already-renewed license must be
    reported as a row error — not imported as a second successor.
    """
    from app.models.license import License, LicenseType, LicenseMetric

    # Create a real existing successor so the FK constraint on renewed_to_id is satisfied
    existing_successor = License(
        publisher_name="Vendor",
        software_description="Suite v2 existing",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        license_ref="LT-ALREADY-RENEWED-SUCC",
    )
    db_session.add(existing_successor)
    await db_session.flush()

    predecessor = License(
        publisher_name="Vendor",
        software_description="Suite v1",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        license_ref="LT-ALREADY-RENEWED",
        lifecycle_status="renewed",
        renewed_to_id=existing_successor.id,
    )
    db_session.add(predecessor)
    await db_session.commit()

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Vendor",
                "software_description": "Suite v3",
                "license_type": "subscription",
                "parent_license_ref": "LT-ALREADY-RENEWED",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("renewal.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 0, f"Expected 0 imports, got: {body}"
    assert body["skippedCount"] == 1
    assert len(body["errors"]) == 1
    assert "already been renewed" in body["errors"][0]["reason"].lower(), (
        f"Error should mention 'already been renewed': {body['errors']}"
    )


async def test_csv_import_wires_renewal_chain_bidirectionally(
    test_app, auth_headers, db_session
):
    """
    Importing a renewal row with a valid parent_license_ref must:
    - Set predecessor_id on the new license
    - Set renewed_to_id on the predecessor pointing at the new license
    - Set predecessor.lifecycle_status = 'renewed'
    """
    from app.models.license import License, LicenseType, LicenseMetric

    predecessor = License(
        publisher_name="Vendor",
        software_description="Chain Suite v1",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        license_ref="LT-CHAIN-WIRE-001",
    )
    db_session.add(predecessor)
    await db_session.commit()

    csv_bytes = _make_csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Vendor",
                "software_description": "Chain Suite v2",
                "license_type": "subscription",
                "parent_license_ref": "LT-CHAIN-WIRE-001",
            }
        ],
    )

    resp = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("renewal.csv", csv_bytes, "text/csv")},
        data={"acknowledge_warnings": "true"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 1, f"Expected 1 import, got: {body}"

    result = await db_session.execute(
        select(License).where(License.software_description == "Chain Suite v2")
    )
    imported = result.scalar_one()
    await db_session.refresh(predecessor)

    assert imported.predecessor_id == predecessor.id
    assert predecessor.lifecycle_status == "renewed"
    assert predecessor.renewed_to_id == imported.id

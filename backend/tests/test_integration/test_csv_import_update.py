"""Integration tests for update-on-LT-Ref-match CSV import."""
from __future__ import annotations

from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.custom_fields import CustomFieldValue
from app.models.license import License
from app.services.csv_importer import ParsedRow
from app.services.import_.license_matcher import annotate_update_targets


def _row(license_ref):
    return ParsedRow(
        row_number=1, publisher_name="Acme", software_description="Widget",
        start_date=None, end_date=None, contract_number="", po_number="",
        invoice_number="", contact_email="", supplier="", cost_centre="",
        license_type="subscription", license_metric="per_user", quantity="",
        sku_code="", unit_price="", total_po_price="", currency="EUR",
        notes=None, budget_owner_email="", external_ref=None,
        license_ref=license_ref, parent_license_ref=None, portal_url=None,
        maintenance_coverage=None, import_status="active",
    )


async def _minimal_payload(**overrides):
    base = {
        "publisherName": "Acme Corp", "softwareDescription": "Acme Suite",
        "licenseType": "subscription", "licenseMetric": "per_user",
        "quantity": "10", "currency": "EUR",
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides):
    resp = await client.post("/api/licenses", json=await _minimal_payload(**overrides), headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_annotate_marks_update_and_create(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers)
    match_row = _row(created["licenseRef"])
    create_row = _row("LT-2099-00000")

    await annotate_update_targets(db_session, [match_row, create_row])

    assert match_row.import_action == "update"
    assert match_row.matched_license_id == created["id"]
    assert create_row.import_action == "create"
    assert create_row.matched_license_id is None


async def test_annotate_flags_ambiguous_row_as_error(test_app, auth_headers, db_session):
    a = await _create_license(test_app, auth_headers)
    ref = a["licenseRef"]
    second = await _create_license(test_app, auth_headers, softwareDescription="Second")
    obj = await db_session.get(License, second["id"])
    obj.license_ref = ref
    await db_session.commit()
    row = _row(ref)

    await annotate_update_targets(db_session, [row])

    assert row.import_status == "error"
    assert any("ambiguous" in e.lower() for e in row.validation_errors)
    assert row.import_action == "create"


from datetime import timezone

from app.services.import_.import_update import apply_import_update
from app.services.import_.import_workflow import run_import_rows


def _full_row(license_ref, **overrides):
    row = _row(license_ref)
    for k, v in overrides.items():
        setattr(row, k, v)
    return row


async def test_apply_update_patches_non_empty_fields_only(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers, supplier="Old Vendor", quantity="10")
    obj = await db_session.get(License, created["id"])

    row = _full_row(created["licenseRef"], supplier="New Vendor", quantity="")
    await apply_import_update(obj, row, {}, db_session, "en-US", "DD/MM/YYYY")

    assert obj.supplier == "New Vendor"   # non-empty -> patched
    assert obj.quantity == "10"           # blank -> preserved


async def test_apply_update_rejects_license_type_change(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers, licenseType="subscription")
    obj = await db_session.get(License, created["id"])
    row = _full_row(created["licenseRef"], license_type="perpetual")

    import pytest
    with pytest.raises(ValueError, match="license_type"):
        await apply_import_update(obj, row, {}, db_session, "en-US", "DD/MM/YYYY")


async def test_apply_update_sets_request_date(test_app, auth_headers, db_session):
    from datetime import datetime as _dt
    created = await _create_license(test_app, auth_headers)
    obj = await db_session.get(License, created["id"])
    row = _full_row(
        created["licenseRef"],
        db_request_date=_dt(2026, 1, 15, tzinfo=timezone.utc),
    )
    await apply_import_update(obj, row, {}, db_session, "en-US", "DD/MM/YYYY")
    assert (obj.request_date.year, obj.request_date.month, obj.request_date.day) == (2026, 1, 15)


async def test_row_database_failure_does_not_poison_remaining_import_rows(
    test_app,
    auth_headers,
    db_session,
):
    invalid = _full_row(None, license_type="maintenance")
    valid = _full_row(None, row_number=2, software_description="Surviving Row")

    result = await run_import_rows(
        [invalid, valid],
        [{}, {}],
        set(),
        1,
        db_session,
    )
    await db_session.commit()

    assert (result.created_count, result.updated_count, result.skipped_count) == (1, 0, 1)
    assert len(result.errors) == 1
    surviving = await db_session.scalar(
        select(License).where(License.software_description == "Surviving Row")
    )
    assert surviving is not None


import csv as _csv_mod
import io as _io
import json


def _make_csv(headers, rows):
    buf = _io.StringIO()
    writer = _csv_mod.DictWriter(buf, fieldnames=headers, extrasaction="ignore", restval="")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    return buf.getvalue().encode("utf-8")


def _mapping(headers):
    # Identity mapping: header == internal field name.
    return json.dumps({"mapping": [{"rawHeader": h, "target": h} for h in headers]})


async def test_execute_update_reconciles_existing_by_ltref(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers, supplier="Old Vendor")
    ref = created["licenseRef"]
    headers = ["license_ref", "publisher_name", "software_description", "supplier"]
    csv_bytes = _make_csv(headers, [{
        "license_ref": ref, "publisher_name": "Acme Corp",
        "software_description": "Acme Suite", "supplier": "New Vendor",
    }])

    resp = await test_app.post(
        "/api/import/execute", headers=auth_headers,
        data={"mapping_json": _mapping(headers), "update_existing": "true"},
        files={"file": ("round.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updatedCount"] == 1
    assert body["importedCount"] == 0

    result = await db_session.execute(select(License).where(License.license_ref == ref))
    matches = result.scalars().all()
    assert len(matches) == 1              # no duplicate created
    assert matches[0].supplier == "New Vendor"

    audit = await db_session.scalar(select(AuditLog).where(AuditLog.action == "license.csv_imported"))
    assert audit is not None
    assert "insertedCount=0" in audit.detail
    assert "updatedCount=1" in audit.detail


async def test_native_confirm_update_reconciles_existing_by_ltref(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers, budgetOwnerEmail="old@example.com")
    ref = created["licenseRef"]
    headers = ["LT Ref", "Publisher", "Description", "Budget Owner"]
    csv_bytes = _make_csv(headers, [{
        "LT Ref": ref,
        "Publisher": "Acme Corp",
        "Description": "Acme Suite",
        "Budget Owner": "new@example.com",
    }])

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("native.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["updateCount"] == 1
    assert preview.json()["createCount"] == 0
    assert preview.json()["rows"][0]["importAction"] == "update"

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("native.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 0
    assert confirm.json()["updatedCount"] == 1

    matches = (await db_session.execute(select(License).where(License.license_ref == ref))).scalars().all()
    assert len(matches) == 1
    assert matches[0].budget_owner_email == "new@example.com"


async def test_native_confirm_updates_existing_custom_field_and_blank_preserves_value(
    test_app,
    auth_headers,
    db_session,
):
    created = await _create_license(test_app, auth_headers)
    definition_response = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Contract Owner", "fieldType": "text", "displayOrder": 0},
    )
    assert definition_response.status_code == 201, definition_response.text
    definition = definition_response.json()
    initial_response = await test_app.put(
        f"/api/licenses/{created['id']}/custom-fields/",
        headers=auth_headers,
        json={"values": [{"customFieldDefId": definition["id"], "valueText": "Alice"}]},
    )
    assert initial_response.status_code == 200, initial_response.text

    headers = ["LT Ref", "Publisher", "Description", "Contract Owner"]
    update_csv = _make_csv(headers, [{
        "LT Ref": created["licenseRef"],
        "Publisher": "Acme Corp",
        "Description": "Acme Suite",
        "Contract Owner": "Bob",
    }])
    update_response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("native-custom-update.csv", update_csv, "text/csv")},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["updatedCount"] == 1

    value = await db_session.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == created["id"],
            CustomFieldValue.custom_field_def_id == definition["id"],
        )
    )
    await db_session.refresh(value)
    assert value.value_text == "Bob"

    blank_csv = _make_csv(headers, [{
        "LT Ref": created["licenseRef"],
        "Publisher": "Acme Corp",
        "Description": "Acme Suite",
        "Contract Owner": "",
    }])
    blank_response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("native-custom-blank.csv", blank_csv, "text/csv")},
    )
    assert blank_response.status_code == 200, blank_response.text
    await db_session.refresh(value)
    assert value.value_text == "Bob"


async def test_native_confirm_without_update_flag_creates_new_license(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers)
    ref = created["licenseRef"]
    headers = ["LT Ref", "Publisher", "Description"]
    csv_bytes = _make_csv(headers, [{
        "LT Ref": ref,
        "Publisher": "Acme Corp",
        "Description": "Acme Suite",
    }])

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "false", "acknowledge_warnings": "true"},
        files={"file": ("native.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["importedCount"] == 1
    assert confirm.json()["updatedCount"] == 0

    all_licenses = (await db_session.execute(select(License))).scalars().all()
    assert len(all_licenses) == 2
    assert len([row for row in all_licenses if row.license_ref == ref]) == 1


async def test_execute_without_update_flag_still_duplicates(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers)
    ref = created["licenseRef"]
    headers = ["license_ref", "publisher_name", "software_description"]
    csv_bytes = _make_csv(headers, [{
        "license_ref": ref, "publisher_name": "Acme Corp", "software_description": "Acme Suite",
    }])

    resp = await test_app.post(
        "/api/import/execute", headers=auth_headers,
        data={"mapping_json": _mapping(headers), "update_existing": "false",
              "acknowledge_warnings": "true"},
        files={"file": ("dup.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["importedCount"] == 1
    assert body.get("updatedCount", 0) == 0
    result = await db_session.execute(select(License).where(License.license_ref == ref))
    assert len(result.scalars().all()) == 1   # original + new one has a *different* generated ref


async def test_preview_mapped_reports_update_and_create_counts(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers)
    ref = created["licenseRef"]
    headers = ["license_ref", "publisher_name", "software_description"]
    csv_bytes = _make_csv(headers, [
        {"license_ref": ref, "publisher_name": "Acme Corp", "software_description": "Acme Suite"},
        {"license_ref": "", "publisher_name": "Beta", "software_description": "Beta Tool"},
    ])

    resp = await test_app.post(
        "/api/import/preview-mapped", headers=auth_headers,
        data={"mapping_json": _mapping(headers), "update_existing": "true"},
        files={"file": ("p.csv", csv_bytes, "text/csv")},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updateCount"] == 1
    assert body["createCount"] == 1
    actions = {r["rowNumber"]: r["importAction"] for r in body["rows"]}
    assert actions[1] == "update"
    assert actions[2] == "create"


async def test_preview_suppresses_ref_duplicate_warning_when_updating(test_app, auth_headers, db_session):
    created = await _create_license(test_app, auth_headers)
    ref = created["licenseRef"]
    headers = ["license_ref", "publisher_name", "software_description"]
    csv_bytes = _make_csv(headers, [
        {"license_ref": ref, "publisher_name": "Acme Corp", "software_description": "Acme Suite"},
    ])

    resp = await test_app.post(
        "/api/import/preview-mapped", headers=auth_headers,
        data={"mapping_json": _mapping(headers), "update_existing": "true"},
        files={"file": ("p.csv", csv_bytes, "text/csv")},
    )

    body = resp.json()
    assert body["rows"][0]["duplicateWarnings"] == []
    assert body["warningSummary"]["duplicateWarningCount"] == 0

"""Generated coverage for every CSV field promised to round-trip."""

from __future__ import annotations

import csv
import io
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum

import pytest
from sqlalchemy import select

from app.models.license import (
    License,
    LicenseMaintenanceLink,
    MaintenanceCoverage,
    MaintenancePricingBasis,
)
from app.models.reference_data import CostCentre, Organization
from app.services.csv_fields import FIELDS
from app.services.csv_importer import _parse_row


@dataclass(frozen=True)
class SampleValue:
    csv: str
    stored: object


SAMPLE_VALUES = {
    "external_ref": SampleValue("EXT-ROUND-TRIP", "EXT-ROUND-TRIP"),
    "publisher_name": SampleValue("Round Trip Publisher", "Round Trip Publisher"),
    "software_description": SampleValue("Round Trip Subscription", "Round Trip Subscription"),
    "contract_number": SampleValue("CONTRACT-42", "CONTRACT-42"),
    "po_number": SampleValue("PO-ROUND-42", "PO-ROUND-42"),
    # A gap on purpose: 4 is kept exactly, not renumbered to 1.
    "po_line_number": SampleValue("4", 4),
    "procurement_reference": SampleValue("PROC-42", "PROC-42"),
    "invoice_number": SampleValue("INV-42", "INV-42"),
    "contact_email": SampleValue("publisher@example.test", "publisher@example.test"),
    "supplier": SampleValue("Round Trip Supplier", "Round Trip Supplier"),
    "cost_centre": SampleValue("CC-ROUND", "CC-ROUND"),
    "budget_owner_email": SampleValue("owner@example.test", "owner@example.test"),
    "secondary_contacts": SampleValue(
        "first@example.test; second@example.test",
        ["first@example.test", "second@example.test"],
    ),
    "license_type": SampleValue("subscription", "subscription"),
    "type_description": SampleValue("Managed specialist service", "Managed specialist service"),
    "is_renewable": SampleValue("Yes", True),
    "license_metric": SampleValue("per_device", "per_device"),
    "quantity": SampleValue("3", "3"),
    "quantity_per_unit": SampleValue("4", "4"),
    "sku_code": SampleValue("SKU-ROUND", "SKU-ROUND"),
    "unit_price": SampleValue("25.50", "25.50"),
    "po_total_override": SampleValue("900.75", "900.75"),
    "currency": SampleValue("USD", "USD"),
    "start_date": SampleValue("2026-01-15", date(2026, 1, 15)),
    "end_date": SampleValue("2027-01-14", date(2027, 1, 14)),
    "notice_date": SampleValue("2026-11-15", date(2026, 11, 15)),
    "request_date": SampleValue("2025-11-01T10:30:00+00:00", datetime(2025, 11, 1, 10, 30)),
    "purchase_date": SampleValue("2025-12-01T12:45:00+00:00", datetime(2025, 12, 1, 12, 45)),
    "portal_url": SampleValue("https://portal.example.test/licenses", "https://portal.example.test/licenses"),
    "notes": SampleValue("Preserve this round-trip note", "Preserve this round-trip note"),
    "maintenance_coverage": SampleValue("included", "included"),
    "maintenance_start_date": SampleValue("2026-02-01", date(2026, 2, 1)),
    "maintenance_end_date": SampleValue("2027-01-31", date(2027, 1, 31)),
    "maintenance_cost": SampleValue("123.45", "123.45"),
    "maintenance_pricing_basis": SampleValue("per_unit", "per_unit"),
    "maintenance_quantity": SampleValue("5", "5"),
    "maintenance_unit_price": SampleValue("24.69", "24.69"),
    "parent_license_refs": SampleValue("PARENT-ONE; PARENT-TWO", ("PARENT-ONE", "PARENT-TWO")),
    "lifecycle_status": SampleValue("legacy", "legacy"),
}

SCENARIO_FIELDS = {
    "subscription": (
        "external_ref",
        "publisher_name",
        "software_description",
        "contract_number",
        "po_number",
        "po_line_number",
        "procurement_reference",
        "invoice_number",
        "contact_email",
        "supplier",
        "cost_centre",
        "budget_owner_email",
        "secondary_contacts",
        "license_type",
        "license_metric",
        "quantity",
        "quantity_per_unit",
        "sku_code",
        "unit_price",
        "po_total_override",
        "currency",
        "start_date",
        "end_date",
        "notice_date",
        "request_date",
        "purchase_date",
        "portal_url",
        "notes",
        "lifecycle_status",
    ),
    "other": ("type_description", "is_renewable"),
    "perpetual_included": (
        "maintenance_coverage",
        "maintenance_start_date",
        "maintenance_end_date",
        "maintenance_cost",
        "maintenance_pricing_basis",
        "maintenance_quantity",
        "maintenance_unit_price",
    ),
    "maintenance_two_parents": ("parent_license_refs",),
}


def _make_csv(headers: list[str], rows: list[dict[str, str]]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore", restval="")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()


def _scenario_row(name: str, **required: str) -> dict[str, str]:
    return {
        **required,
        **{field: SAMPLE_VALUES[field].csv for field in SCENARIO_FIELDS[name]},
    }


async def _create_license(test_app, auth_headers, **overrides) -> dict:
    payload = {
        "publisherName": "Update Publisher",
        "softwareDescription": "Update License",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "currency": "EUR",
    }
    payload.update(overrides)
    response = await test_app.post("/api/licenses", headers=auth_headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _comparable(value: object) -> object:
    return value.value if isinstance(value, Enum) else value


@pytest.mark.parametrize(
    ("explicit_lifecycle", "expected_lifecycle", "expected_warning"),
    [
        ("", None, None),
        ("active", None, None),
        ("legacy", "legacy", None),
        ("renewed", "legacy", None),
        ("pending_renewal", None, "renewal state is not imported"),
    ],
)
def test_explicit_lifecycle_status_follows_decision_r1(
    explicit_lifecycle,
    expected_lifecycle,
    expected_warning,
):
    row = _parse_row(
        1,
        {
            "publisher_name": "Lifecycle Publisher",
            "software_description": "Expired Subscription",
            "license_type": "subscription",
            "end_date": "2000-01-01",
            "lifecycle_status": explicit_lifecycle,
        },
    )

    assert row.lifecycle_status == expected_lifecycle
    assert (expected_warning in row.warnings) if expected_warning else not row.warnings


def test_expired_row_without_lifecycle_column_keeps_legacy_classification():
    row = _parse_row(
        1,
        {
            "publisher_name": "Lifecycle Publisher",
            "software_description": "Expired Subscription",
            "license_type": "subscription",
            "end_date": "2000-01-01",
        },
    )

    assert row.lifecycle_status == "legacy"


def test_explicit_lifecycle_does_not_bypass_required_identity_fields():
    row = _parse_row(
        1,
        {
            "publisher_name": "",
            "software_description": "",
            "license_type": "subscription",
            "lifecycle_status": "legacy",
        },
    )

    assert row.import_status == "error"
    assert row.validation_errors


async def test_every_round_trip_field_has_one_scenario_and_survives_import(
    test_app,
    auth_headers,
    db_session,
):
    round_trip_fields = {field.target for field in FIELDS if field.round_trip}
    scenario_owners = Counter(field for fields in SCENARIO_FIELDS.values() for field in fields)

    assert set(SAMPLE_VALUES) == round_trip_fields
    assert set(scenario_owners) == round_trip_fields
    assert all(count == 1 for count in scenario_owners.values())

    db_session.add_all(
        [
            Organization(
                name="Round Trip Publisher",
                normalized_name="round trip publisher",
                is_publisher=True,
                is_supplier=False,
            ),
            Organization(
                name="Round Trip Supplier",
                normalized_name="round trip supplier",
                is_publisher=False,
                is_supplier=True,
            ),
            CostCentre(name="CC-ROUND", normalized_name="cc-round"),
        ]
    )
    await db_session.flush()

    rows = [
        _scenario_row("subscription"),
        _scenario_row(
            "other",
            publisher_name="Round Trip Publisher",
            software_description="Round Trip Other",
            license_type="other",
        ),
        _scenario_row(
            "perpetual_included",
            publisher_name="Round Trip Publisher",
            software_description="Round Trip Perpetual",
            license_type="perpetual",
            currency="EUR",
        ),
        {
            "license_ref": "PARENT-ONE",
            "publisher_name": "Round Trip Publisher",
            "software_description": "Round Trip Parent One",
            "license_type": "perpetual",
        },
        {
            "license_ref": "PARENT-TWO",
            "publisher_name": "Round Trip Publisher",
            "software_description": "Round Trip Parent Two",
            "license_type": "perpetual",
        },
        _scenario_row(
            "maintenance_two_parents",
            publisher_name="Round Trip Publisher",
            software_description="Round Trip Maintenance",
            license_type="maintenance",
            start_date="2026-01-01",
            end_date="2027-12-31",
        ),
    ]
    headers = list(dict.fromkeys(key for row in rows for key in row))
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"acknowledge_warnings": "true"},
        files={"file": ("round-trip.csv", _make_csv(headers, rows), "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["importedCount"] == len(rows)

    licenses = (
        await db_session.execute(
            select(License).where(License.publisher_name == "Round Trip Publisher")
        )
    ).scalars().all()
    by_description = {license_obj.software_description: license_obj for license_obj in licenses}
    scenario_licenses = {
        "subscription": by_description["Round Trip Subscription"],
        "other": by_description["Round Trip Other"],
        "perpetual_included": by_description["Round Trip Perpetual"],
        "maintenance_two_parents": by_description["Round Trip Maintenance"],
    }

    for scenario, fields in SCENARIO_FIELDS.items():
        license_obj = scenario_licenses[scenario]
        for field in fields:
            if field == "parent_license_refs":
                continue
            assert _comparable(getattr(license_obj, field)) == SAMPLE_VALUES[field].stored, (
                scenario,
                field,
            )

    maintenance = scenario_licenses["maintenance_two_parents"]
    links = (
        await db_session.execute(
            select(LicenseMaintenanceLink).where(
                LicenseMaintenanceLink.maintenance_license_id == maintenance.id
            )
        )
    ).scalars().all()
    linked_descriptions = {
        (await db_session.get(License, link.parent_license_id)).software_description
        for link in links
    }
    assert linked_descriptions == {"Round Trip Parent One", "Round Trip Parent Two"}


async def test_conflicting_manual_po_totals_warn_and_first_value_wins(
    test_app,
    auth_headers,
    db_session,
):
    rows = [
        {
            "publisher_name": "Override Publisher",
            "software_description": "First line",
            "license_type": "subscription",
            "po_number": "PO  42",
            "currency": "EUR",
            "po_total_manual": "500.00",
        },
        {
            "publisher_name": "Override Publisher",
            "software_description": "Second line",
            "license_type": "subscription",
            "po_number": " po 42 ",
            "currency": "EUR",
            "po_total_manual": "700.00",
        },
    ]
    csv_bytes = _make_csv(list(rows[0]), rows)

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("conflicting-totals.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert "first value" in " ".join(preview.json()["rows"][1]["warnings"]).lower()

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"acknowledge_warnings": "true"},
        files={"file": ("conflicting-totals.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    licenses = (
        await db_session.execute(
            select(License).where(License.publisher_name == "Override Publisher")
        )
    ).scalars().all()
    assert {license_obj.po_total_override for license_obj in licenses} == {"500.00"}


async def test_update_import_writes_procurement_dates_and_secondary_contacts(
    test_app,
    auth_headers,
    db_session,
):
    created = await _create_license(test_app, auth_headers)
    row = {
        "license_ref": created["licenseRef"],
        "publisher_name": "Update Publisher",
        "software_description": "Update License",
        "request_date": "2026-03-01T09:15:00+00:00",
        "purchase_date": "2026-03-15T14:45:00+00:00",
        "secondary_contacts": "new-one@example.test; new-two@example.test",
    }
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("update.csv", _make_csv(list(row), [row]), "text/csv")},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    updated = await db_session.get(License, created["id"])
    assert updated.request_date == datetime(2026, 3, 1, 9, 15)
    assert updated.purchase_date == datetime(2026, 3, 15, 14, 45)
    assert updated.secondary_contacts == ["new-one@example.test", "new-two@example.test"]


async def test_update_import_corrects_included_maintenance_fields(
    test_app,
    auth_headers,
    db_session,
):
    created = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Included Parent",
        licenseType="perpetual",
        maintenanceCoverage="included",
        maintenanceStartDate="2026-01-01",
        maintenanceEndDate="2026-12-31",
        maintenanceCost="100.00",
    )
    row = {
        "license_ref": created["licenseRef"],
        "publisher_name": "Update Publisher",
        "software_description": "Included Parent",
        "maintenance_coverage": "included",
        "maintenance_start_date": "2026-02-01",
        "maintenance_end_date": "2027-01-31",
        "maintenance_cost": "246.90",
        "maintenance_pricing_basis": "per_unit",
        "maintenance_quantity": "10",
        "maintenance_unit_price": "24.69",
    }
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("included-update.csv", _make_csv(list(row), [row]), "text/csv")},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    updated = await db_session.get(License, created["id"])
    assert updated.maintenance_coverage == MaintenanceCoverage.included
    assert updated.maintenance_start_date == date(2026, 2, 1)
    assert updated.maintenance_end_date == date(2027, 1, 31)
    assert updated.maintenance_cost == "246.90"
    assert updated.maintenance_pricing_basis == MaintenancePricingBasis.per_unit
    assert updated.maintenance_quantity == "10"
    assert updated.maintenance_unit_price == "24.69"


async def test_maintenance_refs_to_existing_licenses_ignore_case_for_every_parent(
    test_app,
    auth_headers,
    db_session,
):
    first = await _create_license(
        test_app, auth_headers, softwareDescription="Covered One", licenseType="perpetual"
    )
    second = await _create_license(
        test_app, auth_headers, softwareDescription="Covered Two", licenseType="perpetual"
    )
    row = {
        "publisher_name": "Update Publisher",
        "software_description": "Shared Maintenance",
        "license_type": "maintenance",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "currency": "EUR",
        "parent_license_refs": f"{first['licenseRef'].lower()}; {second['licenseRef'].lower()}",
    }
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("shared-maintenance.csv", _make_csv(list(row), [row]), "text/csv")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["errors"] == []
    links = (await db_session.execute(select(LicenseMaintenanceLink.parent_license_id))).scalars().all()
    assert sorted(links) == sorted([first["id"], second["id"]])


async def test_update_import_matches_lt_ref_ignoring_case_and_spaces(
    test_app,
    auth_headers,
    db_session,
):
    created = await _create_license(
        test_app, auth_headers, softwareDescription="Case Target", licenseType="subscription"
    )
    row = {
        "license_ref": f"  {created['licenseRef'].lower()} ",
        "publisher_name": "Update Publisher",
        "software_description": "Case Target",
        "notes": "updated through a lowercase ref",
    }
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("case-update.csv", _make_csv(list(row), [row]), "text/csv")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["updatedCount"] == 1
    db_session.expire_all()
    updated = await db_session.get(License, created["id"])
    assert updated.notes == "updated through a lowercase ref"


async def test_update_import_rejects_coverage_not_valid_for_the_license_type(
    test_app,
    auth_headers,
    db_session,
):
    created = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Subscription Coverage",
        licenseType="subscription",
    )
    row = {
        "license_ref": created["licenseRef"],
        "publisher_name": "Update Publisher",
        "software_description": "Subscription Coverage",
        "maintenance_coverage": "separately_tracked",
    }
    response = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("coverage-update.csv", _make_csv(list(row), [row]), "text/csv")},
    )

    assert response.status_code == 200, response.text
    assert any("Separately tracked" in error["reason"] for error in response.json()["errors"])
    db_session.expire_all()
    unchanged = await db_session.get(License, created["id"])
    assert unchanged.maintenance_coverage == MaintenanceCoverage.included


async def test_update_import_ignores_maintenance_fields_when_active_record_exists(
    test_app,
    auth_headers,
    db_session,
):
    parent = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Linked Parent",
        licenseType="perpetual",
    )
    await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Linked Maintenance",
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        startDate="2026-01-01",
        endDate="2027-12-31",
        unitPrice="50.00",
    )
    before = await db_session.get(License, parent["id"])
    original_end = before.maintenance_end_date
    row = {
        "license_ref": parent["licenseRef"],
        "publisher_name": "Update Publisher",
        "software_description": "Linked Parent",
        "maintenance_end_date": "2028-12-31",
    }
    csv_bytes = _make_csv(list(row), [row])

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("active-maintenance-update.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert "active maintenance" in " ".join(preview.json()["rows"][0]["warnings"]).lower()

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("active-maintenance-update.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    db_session.expire_all()
    updated = await db_session.get(License, parent["id"])
    assert updated.maintenance_end_date == original_end


async def _line_numbers(db_session, publisher: str) -> dict[str, int | None]:
    db_session.expire_all()
    licenses = (
        await db_session.execute(select(License).where(License.publisher_name == publisher))
    ).scalars().all()
    return {license_obj.software_description: license_obj.po_line_number for license_obj in licenses}


async def test_mixed_import_preview_matches_the_line_numbers_that_are_written(
    test_app,
    auth_headers,
    db_session,
):
    await _create_license(test_app, auth_headers, publisherName="Existing PO", poNumber="PO-MIX")
    base = {"publisher_name": "Mixed Lines", "license_type": "subscription", "currency": "EUR"}
    rows = [
        {**base, "software_description": "taken", "po_number": "PO-MIX", "po_line": "1"},
        {**base, "software_description": "free gap", "po_number": "PO-MIX", "po_line": "4"},
        {**base, "software_description": "new po", "po_number": "PO-NEW", "po_line": "2"},
        {**base, "software_description": "claims 3 first", "po_number": "PO-NEW2", "po_line": "3"},
        {**base, "software_description": "claims 3 second", "po_number": "po-new2", "po_line": "3"},
        {**base, "software_description": "blank line", "po_number": "PO-NEW2", "po_line": ""},
    ]
    csv_bytes = _make_csv(list(rows[0]), rows)

    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        files={"file": ("mixed-lines.csv", csv_bytes, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    warnings = {row["softwareDescription"]: " ".join(row["warnings"]) for row in preview.json()["rows"]}
    assert "already used" in warnings["taken"] and "line 2" in warnings["taken"]
    assert "already used" in warnings["claims 3 second"] and "line 4" in warnings["claims 3 second"]
    assert "PO line" not in warnings["free gap"]
    assert "PO line" not in warnings["new po"]
    assert "PO line" not in warnings["claims 3 first"]
    assert "PO line" not in warnings["blank line"]

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"acknowledge_warnings": "true"},
        files={"file": ("mixed-lines.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert await _line_numbers(db_session, "Mixed Lines") == {
        "taken": 2,
        "free gap": 4,
        "new po": 2,
        "claims 3 first": 3,
        "claims 3 second": 4,
        "blank line": 5,
    }


async def test_purchasing_export_item_column_is_the_po_line(test_app, auth_headers, db_session):
    # Purchasing exports (Flexera among them) number PO lines in "Item" and
    # put the product text in "Description".
    header = ["Publisher", "Description", "Item", "PO Number", "License Type", "Currency"]
    rows = [
        {"Publisher": "Item Export", "Description": "Suite seats", "Item": "1", "PO Number": "PO-ITEM",
         "License Type": "subscription", "Currency": "EUR"},
        {"Publisher": "Item Export", "Description": "Add-on", "Item": "2", "PO Number": "PO-ITEM",
         "License Type": "subscription", "Currency": "EUR"},
    ]
    csv_bytes = _make_csv(header, rows)

    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"acknowledge_warnings": "true"},
        files={"file": ("purchasing-export.csv", csv_bytes, "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    assert await _line_numbers(db_session, "Item Export") == {"Suite seats": 1, "Add-on": 2}


async def test_update_import_ignores_the_files_line_number_but_follows_a_po_change(
    test_app,
    auth_headers,
    db_session,
):
    other = await _create_license(test_app, auth_headers, publisherName="Line Owner", poNumber="PO-TARGET")
    created = await _create_license(
        test_app, auth_headers, softwareDescription="Update License", poNumber="PO-SOURCE"
    )
    assert other["poLineNumber"] == 1 and created["poLineNumber"] == 1

    ignored = {
        "license_ref": created["licenseRef"],
        "publisher_name": "Update Publisher",
        "software_description": "Update License",
        "po_line": "9",
    }
    preview = await test_app.post(
        "/api/import/preview",
        headers=auth_headers,
        data={"update_existing": "true"},
        files={"file": ("ignored.csv", _make_csv(list(ignored), [ignored]), "text/csv")},
    )
    assert "ignored" in " ".join(preview.json()["rows"][0]["warnings"])
    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("ignored.csv", _make_csv(list(ignored), [ignored]), "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    db_session.expire_all()
    assert (await db_session.get(License, created["id"])).po_line_number == 1

    moved = {**ignored, "po_line": "", "po_number": "PO-TARGET"}
    confirm = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        data={"update_existing": "true", "acknowledge_warnings": "true"},
        files={"file": ("moved.csv", _make_csv(list(moved), [moved]), "text/csv")},
    )
    assert confirm.status_code == 200, confirm.text
    db_session.expire_all()
    updated = await db_session.get(License, created["id"])
    assert updated.po_number == "PO-TARGET" and updated.po_line_number == 2


async def test_license_export_lists_the_po_line_and_a_deleted_lines_gap_stays(
    test_app,
    auth_headers,
    db_session,
):
    ids = {}
    for description in ("first", "second", "third"):
        created = await _create_license(
            test_app, auth_headers, softwareDescription=description, poNumber="PO-GAP"
        )
        ids[description] = created["id"]
    # Line 2 is removed: the number stays used up, so the gap stays.
    deleted = await test_app.delete(f"/api/licenses/{ids['second']}", headers=auth_headers)
    assert deleted.status_code in (200, 204), deleted.text

    export = await test_app.get("/api/licenses/export", headers=auth_headers)
    assert export.status_code == 200
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert {row["Software Description"]: row["PO Line"] for row in rows} == {"first": "1", "third": "3"}
    later = await _create_license(test_app, auth_headers, softwareDescription="later", poNumber="PO-GAP")
    assert later["poLineNumber"] == 4

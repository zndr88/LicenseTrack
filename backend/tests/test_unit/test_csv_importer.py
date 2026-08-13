"""
Unit tests for app.services.csv_importer.parse_csv.

Pure-function tests — no fixtures required.
"""

import csv
import io
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.services.csv_importer import build_custom_field_header_map, parse_csv

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FUTURE = (date.today() + timedelta(days=365)).isoformat()
_PAST = (date.today() - timedelta(days=365)).isoformat()


def _csv(headers: list[str], rows: list[dict] | None = None) -> bytes:
    """Build CSV bytes from an ordered list of headers and optional row dicts."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for row in rows or []:
        writer.writerow(row)
    return buf.getvalue().encode()


# ---------------------------------------------------------------------------
# 1a — Valid minimal import
# ---------------------------------------------------------------------------

def test_valid_minimal_import():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": _FUTURE}],
    )
    result = parse_csv(csv_bytes)

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.import_status == "active"
    assert row.validation_errors == []
    assert row.warnings == []


@pytest.mark.parametrize("license_type", ["service", "other"])
def test_native_import_accepts_service_and_other_license_types(license_type):
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Implementation", "license_type": license_type}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.license_type == license_type
    assert row.import_status == "active"
    assert row.validation_errors == []


@pytest.mark.parametrize(
    ("purchase_type", "expected"),
    [
        ("Software Subscription", "subscription"),
        ("Software Maintenance", "maintenance"),
        ("Software Baseline", "perpetual"),
        ("Software", "perpetual"),
        ("Service", "service"),
    ],
)
def test_flexera_purchase_type_aliases_map_to_license_type(purchase_type, expected):
    csv_bytes = _csv(
        ["publisher_name", "software_description", "purchase_type"],
        [{"publisher_name": "Acme", "software_description": "Widget", "purchase_type": purchase_type}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.license_type == expected
    assert row.import_status == "active"
    assert row.validation_errors == []


def test_item_fallback_does_not_override_explicit_software_description():
    csv_bytes = _csv(
        ["publisher_name", "Item", "software_description"],
        [{
            "publisher_name": "Acme",
            "Item": "ERP-EXT-123",
            "software_description": "Acme ERP Suite",
        }],
    )

    result = parse_csv(csv_bytes)

    assert result.headers_found == ["publisher_name", "software_description"]
    assert result.rows[0].software_description == "Acme ERP Suite"


def test_native_parser_extracts_existing_custom_fields_by_name_and_stable_key():
    definitions = [SimpleNamespace(name="Contract Owner", field_key="cf_contract_owner")]
    custom_headers = build_custom_field_header_map(definitions)
    csv_bytes = _csv(
        ["publisher_name", "software_description", "Contract Owner", "cf_contract_owner"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "Contract Owner": "Alice",
            "cf_contract_owner": "ignored duplicate",
        }],
    )

    result = parse_csv(csv_bytes, custom_field_header_map=custom_headers)

    assert result.headers_found == ["publisher_name", "software_description", "cf_contract_owner"]
    assert result.custom_rows == [{"cf_contract_owner": "Alice"}]


def test_custom_field_display_aliases_are_safe_and_do_not_override_native_fields():
    definitions = [
        SimpleNamespace(name="Publisher", field_key="cf_publisher"),
        SimpleNamespace(name="Asset Owner", field_key="cf_asset_owner"),
        SimpleNamespace(name="Asset-Owner", field_key="cf_asset_owner_alt"),
    ]

    aliases = build_custom_field_header_map(definitions)

    assert aliases["cf_publisher"] == "cf_publisher"
    assert aliases["cf_asset_owner"] == "cf_asset_owner"
    assert aliases["cf_asset_owner_alt"] == "cf_asset_owner_alt"
    assert "publisher" not in aliases
    assert "asset_owner" not in aliases


# ---------------------------------------------------------------------------
# 1b — Date format variants
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw_date,date_format,expected", [
    ("2026-06-15", "DD/MM/YYYY", date(2026, 6, 15)),  # ISO is always accepted
    ("15/06/2026", "DD/MM/YYYY", date(2026, 6, 15)),
    ("1-1-2023", "DD/MM/YYYY", date(2023, 1, 1)),
    ("'1-1-2023'", "DD/MM/YYYY", date(2023, 1, 1)),
    ("1-1-2023'", "DD/MM/YYYY", date(2023, 1, 1)),
    ("06/15/2026", "MM/DD/YYYY", date(2026, 6, 15)),
])
def test_date_format_variants(raw_date, date_format, expected):
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": raw_date}],
    )
    row = parse_csv(csv_bytes, date_format=date_format).rows[0]

    assert row.db_end_date == expected
    assert row.validation_errors == []
    assert row.warnings == []


def test_perpetual_end_date():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": "perpetual"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.db_end_date is None
    assert row.end_date is None
    assert row.import_status == "active"


# ---------------------------------------------------------------------------
# 1c — Invalid date produces warning, not error
# ---------------------------------------------------------------------------

def test_2099_end_date_is_perpetual_warning_not_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": "1-1-2099"}],
    )
    row = parse_csv(csv_bytes, date_format="DD/MM/YYYY").rows[0]

    assert row.import_status == "active"
    assert row.validation_errors == []
    assert row.db_end_date is None
    assert row.end_date is None
    assert any("treated as perpetual" in warning for warning in row.warnings)


def test_invalid_date_produces_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": "not-a-date"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert any("Unrecognised date format" in e for e in row.validation_errors)
    assert row.db_end_date is None
    assert row.import_status == "error"


def test_declared_date_format_controls_ambiguous_dates():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": "01/02/2027"}],
    )

    european = parse_csv(csv_bytes, date_format="DD/MM/YYYY").rows[0]
    american = parse_csv(csv_bytes, date_format="MM/DD/YYYY").rows[0]

    assert european.db_end_date == date(2027, 2, 1)
    assert american.db_end_date == date(2027, 1, 2)


def test_localized_numeric_fields_land_canonical():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "quantity", "unit_price", "total_po_price"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "quantity": "1.000",
            "unit_price": "1.234,50",
            "total_po_price": "1.234.500,00",
        }],
    )

    row = parse_csv(csv_bytes, number_format_locale="nl-BE").rows[0]

    assert row.quantity == "1000"
    assert row.unit_price == "1234.50"
    assert row.total_po_price == "1234500.00"
    assert row.import_status == "active"


def test_effective_quantity_is_not_auto_mapped_to_purchase_quantity():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "Effective Quantity", "Purchase Quantity"],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "Effective Quantity": "5000000",
            "Purchase Quantity": "1",
        }],
    )

    result = parse_csv(csv_bytes)

    assert result.rows[0].quantity == "1"
    assert result.rows[0].quantity_per_unit == "5000000"
    assert result.rows[0].effective_quantity == "5000000"


def test_quantity_per_unit_is_native_import_field():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "purchase_quantity", "quantity_per_unit"],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "purchase_quantity": "2",
            "quantity_per_unit": "5000000",
        }],
    )

    row = parse_csv(csv_bytes).rows[0]

    assert row.quantity == "2"
    assert row.quantity_per_unit == "5000000"
    assert row.effective_quantity == ""


def test_explicit_quantity_per_unit_is_not_overwritten_by_effective_quantity():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "purchase_quantity", "quantity_per_unit", "effective_quantity"],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "purchase_quantity": "1",
            "quantity_per_unit": "1",
            "effective_quantity": "5000000",
        }],
    )

    row = parse_csv(csv_bytes).rows[0]

    assert row.quantity == "1"
    assert row.quantity_per_unit == "1"
    assert any("effective_quantity does not equal" in warning for warning in row.warnings)


def test_missing_quantity_per_unit_does_not_default_import_update_value():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "purchase_quantity"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "purchase_quantity": "7",
        }],
    )

    row = parse_csv(csv_bytes).rows[0]

    assert row.quantity == "7"
    assert row.quantity_per_unit == ""


def test_quantity_price_mismatch_adds_row_warning():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "quantity", "unit_price", "total_po_price"],
        [{
            "publisher_name": "SonarSource",
            "software_description": "SonarQube",
            "quantity": "5000000",
            "unit_price": "1000",
            "total_po_price": "1000",
        }],
    )

    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "active"
    assert any("entitlement quantity per unit" in warning for warning in row.warnings)


def test_localized_numeric_fields_accept_currency_affixes():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "unit_price", "total_po_price"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "unit_price": "€11.000,00",
            "total_po_price": "EUR 11.000,00",
        }],
    )

    row = parse_csv(csv_bytes, number_format_locale="de-DE").rows[0]

    assert row.unit_price == "11000.00"
    assert row.total_po_price == "11000.00"
    assert row.import_status == "active"


def test_invalid_localized_numeric_field_is_a_row_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "unit_price"],
        [{"publisher_name": "Acme", "software_description": "Widget", "unit_price": "not-a-number"}],
    )

    row = parse_csv(csv_bytes, number_format_locale="nl-BE").rows[0]

    assert row.import_status == "error"
    assert any("unit_price" in e for e in row.validation_errors)


# ---------------------------------------------------------------------------
# 1d — Missing required fields
# ---------------------------------------------------------------------------

def test_both_required_fields_missing():
    csv_bytes = _csv(["end_date"], [{"end_date": _FUTURE}])
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "error"
    assert row.validation_errors


def test_only_publisher_missing():
    csv_bytes = _csv(
        ["software_description", "end_date"],
        [{"software_description": "Widget", "end_date": _FUTURE}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "active"
    assert any("publisher_name" in e for e in row.validation_errors)


def test_only_description_missing():
    csv_bytes = _csv(
        ["publisher_name", "end_date"],
        [{"publisher_name": "Acme", "end_date": _FUTURE}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "active"
    assert any("software_description" in e for e in row.validation_errors)


# ---------------------------------------------------------------------------
# 1e — Legacy classification
# ---------------------------------------------------------------------------

def test_legacy_exempt_classification():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "end_date"],
        [{"publisher_name": "Acme", "software_description": "Widget", "end_date": _PAST}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "legacy_exempt"
    assert row.lifecycle_status == "legacy"
    assert row.is_completeness_exempt is True


def test_legacy_incomplete_classification():
    # publisher_name missing, end_date in past → legacy_incomplete
    csv_bytes = _csv(
        ["software_description", "end_date"],
        [{"software_description": "Widget", "end_date": _PAST}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "legacy_incomplete"


# ---------------------------------------------------------------------------
# 1f — Enum validation
# ---------------------------------------------------------------------------

def test_valid_license_type():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_type": "subscription"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.license_type == "subscription"
    assert not any("license_type" in w for w in row.warnings)


def test_invalid_license_type():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_type": "banana"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert any("Unrecognised license_type" in e for e in row.validation_errors)
    assert row.import_status == "error"
    assert row.license_type == ""


def test_valid_license_metric():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_metric"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_metric": "per_user"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.license_metric == "per_user"
    assert not any("license_metric" in w for w in row.warnings)


@pytest.mark.parametrize("raw_metric,expected", [
    ("named_user", "per_user"),
    ("user", "per_user"),
    ("device", "per_device"),
    ("named device", "per_device"),
])
def test_flexera_license_metric_aliases(raw_metric, expected):
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_metric"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_metric": raw_metric}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.license_metric == expected
    assert row.import_status == "active"


@pytest.mark.parametrize("raw_type", ["named_user", "user", "device"])
def test_flexera_metric_values_are_not_accepted_as_license_type(raw_type):
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_type": raw_type}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "error"
    assert any("license_type" in e for e in row.validation_errors)


def test_invalid_license_metric():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_metric"],
        [{"publisher_name": "Acme", "software_description": "Widget", "license_metric": "banana"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert any("Unrecognised license_metric" in e for e in row.validation_errors)
    assert row.import_status == "error"
    assert row.license_metric == ""


def test_parse_csv_recognizes_parent_license_ref():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type", "parent_license_ref"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
                "parent_license_ref": "LT-2025-00001",
            }
        ],
    )
    result = parse_csv(csv_bytes)

    assert result.rows[0].parent_license_ref == "LT-2025-00001"


def test_parse_csv_maintenance_without_parent_ref_is_deferred_to_batch_validation():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "license_type"],
        [
            {
                "publisher_name": "Acme",
                "software_description": "Acme Maintenance",
                "license_type": "maintenance",
            }
        ],
    )
    result = parse_csv(csv_bytes)

    assert result.rows[0].import_status == "active"
    assert result.rows[0].validation_errors == []
    assert result.rows[0].parent_license_ref is None


# ---------------------------------------------------------------------------
# 1g — Currency default
# ---------------------------------------------------------------------------

def test_currency_defaults_to_eur():
    csv_bytes = _csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    assert parse_csv(csv_bytes).rows[0].currency == "EUR"


def test_currency_explicit_usd():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "currency"],
        [{"publisher_name": "Acme", "software_description": "Widget", "currency": "USD"}],
    )
    assert parse_csv(csv_bytes).rows[0].currency == "USD"


# ---------------------------------------------------------------------------
# 1h — Header aliases
# ---------------------------------------------------------------------------

def test_header_aliases():
    raw_csv = (
        "License Ref,External Ref,Publisher,Description,Contract #,PO #,"
        "Cost Center,Type,Metric,Qty,SKU,Invoice\n"
        "LT-2026-00001,EXT-1,Acme,Widget,C-1,PO-1,IT Ops,"
        "Subscription,Per User,25,SKU-1,INV-1\n"
    )
    result = parse_csv(raw_csv.encode())

    assert "license_ref" in result.headers_found
    assert "external_ref" in result.headers_found
    assert "publisher_name" in result.headers_found
    assert "software_description" in result.headers_found
    assert "contract_number" in result.headers_found
    assert "po_number" in result.headers_found
    assert "cost_centre" in result.headers_found
    assert "license_type" in result.headers_found
    assert "license_metric" in result.headers_found
    assert "quantity" in result.headers_found

    row = result.rows[0]
    assert row.license_ref == "LT-2026-00001"
    assert row.external_ref == "EXT-1"
    assert row.publisher_name == "Acme"
    assert row.software_description == "Widget"
    assert row.contract_number == "C-1"
    assert row.po_number == "PO-1"
    assert row.cost_centre == "IT Ops"
    assert row.license_type == "subscription"
    assert row.license_metric == "per_user"
    assert row.quantity == "25"
    assert row.sku_code == "SKU-1"
    assert row.invoice_number == "INV-1"


# ---------------------------------------------------------------------------
# 1h-2 — Procurement milestone datetimes (request_date / purchase_date)
# ---------------------------------------------------------------------------

def test_request_and_purchase_date_headers_auto_map_and_parse():
    csv_bytes = _csv(
        ["Publisher", "Description", "Request Date", "Purchase Date"],
        [{
            "Publisher": "Acme",
            "Description": "Widget",
            "Request Date": "2026-01-15",
            "Purchase Date": "2026-02-20",
        }],
    )
    result = parse_csv(csv_bytes)

    assert "request_date" in result.headers_found
    assert "purchase_date" in result.headers_found
    row = result.rows[0]
    assert row.validation_errors == []
    assert row.db_request_date is not None
    assert (row.db_request_date.year, row.db_request_date.month, row.db_request_date.day) == (2026, 1, 15)
    assert row.db_request_date.tzinfo is not None
    assert (row.db_purchase_date.year, row.db_purchase_date.month, row.db_purchase_date.day) == (2026, 2, 20)
    assert row.db_purchase_date.tzinfo is not None


def test_procurement_reference_header_auto_maps():
    csv_bytes = _csv(
        ["Publisher", "Description", "Procurement Reference"],
        [{
            "Publisher": "Acme",
            "Description": "Widget",
            "Procurement Reference": "REQ-2026-001",
        }],
    )
    result = parse_csv(csv_bytes)
    row = result.rows[0]

    assert "procurement_reference" in result.headers_found
    assert row.procurement_reference == "REQ-2026-001"


def test_purchase_date_maps_to_purchase_date_field_not_start_date():
    # Regression: "Purchase Date" was mis-aliased to start_date (Flexera fallback).
    csv_bytes = _csv(
        ["Publisher", "Description", "Purchase Date"],
        [{"Publisher": "Acme", "Description": "Widget", "Purchase Date": "2026-02-20"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.db_purchase_date is not None
    assert row.db_start_date is None
    assert row.start_date is None


def test_request_date_accepts_iso_datetime_round_trip():
    # LicenseTrack export emits full ISO datetimes for these fields.
    csv_bytes = _csv(
        ["Publisher", "Description", "Request Date"],
        [{"Publisher": "Acme", "Description": "Widget", "Request Date": "2026-01-15T09:30:00Z"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.validation_errors == []
    assert row.db_request_date.tzinfo is not None
    assert (row.db_request_date.year, row.db_request_date.month, row.db_request_date.day) == (2026, 1, 15)
    assert row.db_request_date.hour == 9


def test_request_date_respects_declared_date_format():
    csv_bytes = _csv(
        ["Publisher", "Description", "Request Date"],
        [{"Publisher": "Acme", "Description": "Widget", "Request Date": "15/06/2026"}],
    )
    row = parse_csv(csv_bytes, date_format="DD/MM/YYYY").rows[0]

    assert (row.db_request_date.year, row.db_request_date.month, row.db_request_date.day) == (2026, 6, 15)


def test_invalid_request_date_is_row_error():
    csv_bytes = _csv(
        ["Publisher", "Description", "Request Date"],
        [{"Publisher": "Acme", "Description": "Widget", "Request Date": "not-a-date"}],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "error"
    assert any("request_date" in e for e in row.validation_errors)
    assert row.db_request_date is None


def test_parsed_row_defaults_to_create_action():
    csv_bytes = _csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    row = parse_csv(csv_bytes).rows[0]
    assert row.import_action == "create"
    assert row.matched_license_id is None


# ---------------------------------------------------------------------------
# 1i — headers_missing
# ---------------------------------------------------------------------------

def test_headers_missing():
    csv_bytes = _csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    result = parse_csv(csv_bytes)

    for expected in ("start_date", "end_date", "contract_number", "po_number", "license_type"):
        assert expected in result.headers_missing
    assert "publisher_name" not in result.headers_missing
    assert "software_description" not in result.headers_missing


# ---------------------------------------------------------------------------
# 1j — BOM handling
# ---------------------------------------------------------------------------

def test_bom_handling():
    csv_bytes = _csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    bom_csv = b"\xef\xbb\xbf" + csv_bytes
    result = parse_csv(bom_csv)

    assert len(result.rows) == 1
    assert "publisher_name" in result.headers_found
    row = result.rows[0]
    assert row.publisher_name == "Acme"
    assert row.validation_errors == []


# ---------------------------------------------------------------------------
# 1k — Empty CSV (headers only, no data rows)
# ---------------------------------------------------------------------------

def test_empty_csv_no_rows():
    csv_bytes = _csv(["publisher_name", "software_description"])
    result = parse_csv(csv_bytes)

    assert result.rows == []


# ---------------------------------------------------------------------------
# currency_defaulted flag
# ---------------------------------------------------------------------------

def test_row_marks_currency_defaulted_when_currency_absent():
    csv_bytes = _csv(
        ["publisher_name", "software_description"],
        [{"publisher_name": "Acme", "software_description": "Widget"}],
    )
    result = parse_csv(csv_bytes)
    assert result.rows[0].currency_defaulted is True


def test_row_does_not_mark_currency_defaulted_when_currency_present():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "currency"],
        [{"publisher_name": "Acme", "software_description": "Widget", "currency": "USD"}],
    )
    result = parse_csv(csv_bytes)
    assert result.rows[0].currency_defaulted is False
    assert result.rows[0].currency == "USD"


# ---------------------------------------------------------------------------
# budget_owner_email CRLF/NUL injection guard
# (CVE-2026-53533 / GHSA-v3q9-hj7j-63hq — this value eventually reaches
# aiosmtplib.send(recipients=...) via the daily notification job)
# ---------------------------------------------------------------------------

def test_budget_owner_email_with_crlf_flagged_as_row_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "budget_owner_email"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "budget_owner_email": "a@b.com\r\nRCPT TO:<evil@x>",
        }],
    )
    result = parse_csv(csv_bytes)

    assert len(result.rows) == 1
    row = result.rows[0]
    # The dangerous value must never be carried through to the parsed row —
    # it is neutralised so downstream schema construction cannot raise.
    assert row.budget_owner_email == ""
    assert row.import_status == "error"
    assert any("budget_owner_email" in e for e in row.validation_errors)


def test_budget_owner_email_normal_value_passes_through():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "budget_owner_email"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "budget_owner_email": "owner@example.com",
        }],
    )
    result = parse_csv(csv_bytes)

    row = result.rows[0]
    assert row.budget_owner_email == "owner@example.com"
    assert row.validation_errors == []


def test_secondary_contacts_auto_map_application_owner_aliases():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "Application Owner Email", "Technical Owner Email"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "Application Owner Email": " app.owner@example.com ",
            "Technical Owner Email": "tech.owner@example.com",
        }],
    )
    result = parse_csv(csv_bytes)
    row = result.rows[0]

    assert "secondary_contacts" in result.headers_found
    assert row.secondary_contacts == ["app.owner@example.com", "tech.owner@example.com"]
    assert row.validation_errors == []


def test_secondary_contacts_split_and_dedupe_values():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "secondary_contacts"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "secondary_contacts": "app.owner@example.com; App.Owner@example.com, legal@example.com",
        }],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.secondary_contacts == ["app.owner@example.com", "legal@example.com"]


def test_secondary_contacts_with_crlf_flagged_as_row_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "application_owner_email"],
        [{
            "publisher_name": "Acme",
            "software_description": "Widget",
            "application_owner_email": "owner@example.com\r\nRCPT TO:<evil@x>",
        }],
    )
    row = parse_csv(csv_bytes).rows[0]

    assert row.import_status == "error"
    assert row.secondary_contacts == []
    assert any("secondary_contacts" in e for e in row.validation_errors)


# ---------------------------------------------------------------------------
# build_warning_summary
# ---------------------------------------------------------------------------

from app.services.import_.import_workflow import build_warning_summary
from app.services.csv_importer import ParsedRow


def _make_row(**kwargs) -> ParsedRow:
    """Minimal ParsedRow for unit tests — only sets the fields you pass."""
    defaults = dict(
        row_number=1,
        publisher_name="Acme",
        software_description="Widget",
        start_date=None,
        end_date=None,
        notice_date=None,
        contract_number="",
        po_number="",
        procurement_reference="",
        invoice_number="",
        contact_email="",
        supplier="",
        cost_centre="",
        license_type="subscription",
        license_metric="per_user",
        quantity="",
        sku_code="",
        unit_price="",
        total_po_price="",
        currency="EUR",
        notes=None,
        budget_owner_email="",
        secondary_contacts=[],
        external_ref=None,
        license_ref=None,
        parent_license_ref=None,
        portal_url=None,
        maintenance_coverage=None,
        import_status="active",
        currency_defaulted=False,
        db_start_date=None,
        db_end_date=None,
        db_notice_date=None,
        is_completeness_exempt=False,
        lifecycle_status=None,
    )
    defaults.update(kwargs)
    return ParsedRow(**defaults)


def test_build_warning_summary_no_warnings():
    row = _make_row()
    summary = build_warning_summary([row])
    assert summary.defaulted_currency_count == 0
    assert summary.defaulted_enum_count == 0
    assert summary.ambiguous_date_count == 0
    assert summary.inferred_parent_count == 0
    assert summary.duplicate_warning_count == 0
    assert summary.rows_with_warnings_count == 0
    assert summary.has_warnings is False


def test_build_warning_summary_defaulted_enum():
    # Unrecognised enum values are now hard errors, so defaulted_enum_count is always 0.
    row = _make_row(warnings=[])
    summary = build_warning_summary([row])
    assert summary.defaulted_enum_count == 0
    assert summary.rows_with_warnings_count == 0
    assert summary.has_warnings is False


def test_build_warning_summary_ambiguous_date():
    # Invalid dates are hard row errors; the compatibility count remains zero.
    row = _make_row(warnings=["start_date: Unrecognised date format: '99-99-99'"])
    summary = build_warning_summary([row])
    assert summary.ambiguous_date_count == 0
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is False


def test_build_warning_summary_legacy_date_warning_does_not_gate():
    """Legacy warning text does not reactivate retired enum/date categories."""
    row = _make_row(warnings=[
        "start_date: Unrecognised date format: '99-99-99'",
    ])
    summary = build_warning_summary([row])
    assert summary.defaulted_enum_count == 0
    assert summary.ambiguous_date_count == 0
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is False


def test_build_warning_summary_two_enum_warnings_counts_row_once():
    """Unrecognised enum values are now hard errors; defaulted_enum_count is always 0."""
    row = _make_row(warnings=[])
    summary = build_warning_summary([row])
    assert summary.defaulted_enum_count == 0
    assert summary.rows_with_warnings_count == 0


def test_build_warning_summary_currency_defaulted():
    row = _make_row(currency_defaulted=True)
    summary = build_warning_summary([row])
    assert summary.defaulted_currency_count == 1
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is False  # currency does NOT gate


def test_build_warning_summary_price_mismatch_gates():
    row = _make_row(
        warnings=[
            "Calculated total (quantity x unit_price) differs from total_po_price by 10x or more; "
            "check whether the mapped quantity is a purchase quantity rather than an entitlement quantity per unit"
        ]
    )

    summary = build_warning_summary([row])

    assert summary.price_mismatch_count == 1
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is True


def test_build_warning_summary_inferred_parent():
    row = _make_row(parent_import_row_number=1)
    summary = build_warning_summary([row])
    assert summary.inferred_parent_count == 1
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is True


def test_build_warning_summary_duplicate_warning():
    row = _make_row(duplicate_warnings=["some warning"])
    summary = build_warning_summary([row])
    assert summary.duplicate_warning_count == 1
    assert summary.rows_with_warnings_count == 1
    assert summary.has_warnings is True


def test_build_warning_summary_error_rows_skipped():
    """Error rows must not contribute to any counts."""
    error_row = _make_row(
        import_status="error",
        warnings=[],
        currency_defaulted=True,
        parent_import_row_number=1,
        duplicate_warnings=["dup"],
    )
    summary = build_warning_summary([error_row])
    assert summary.defaulted_enum_count == 0
    assert summary.rows_with_warnings_count == 0
    assert summary.has_warnings is False


def test_build_warning_summary_mixed_rows():
    """3 rows: 1 clean, 1 with error (skipped), 1 clean. Enum issues are now hard errors."""
    rows = [
        _make_row(row_number=1, warnings=[]),
        _make_row(row_number=2, import_status="error", warnings=["publisher_name is missing"]),
        _make_row(row_number=3),
    ]
    summary = build_warning_summary(rows)
    assert summary.defaulted_enum_count == 0
    assert summary.rows_with_warnings_count == 0
    assert summary.has_warnings is False

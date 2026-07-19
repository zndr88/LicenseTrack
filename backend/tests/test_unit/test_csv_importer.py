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


def test_invalid_localized_numeric_field_is_a_row_error():
    csv_bytes = _csv(
        ["publisher_name", "software_description", "unit_price"],
        [{"publisher_name": "Acme", "software_description": "Widget", "unit_price": "€12"}],
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
        contract_number="",
        po_number="",
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
        external_ref=None,
        license_ref=None,
        parent_license_ref=None,
        portal_url=None,
        maintenance_coverage=None,
        import_status="active",
        currency_defaulted=False,
        db_start_date=None,
        db_end_date=None,
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

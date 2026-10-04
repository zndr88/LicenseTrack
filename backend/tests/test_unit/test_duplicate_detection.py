# backend/tests/test_unit/test_duplicate_detection.py
"""Unit tests for duplicate_detection helpers (pure-function, no DB)."""

from app.services.import_.duplicate_detection import (
    _norm_text,
    _dates_overlap,
    _match_duplicate,
    _match_fields_sentence,
)
from app.services.csv_importer import ParsedRow


def _row(publisher="Acme", software="Widget", contract="C1", po="P1",
         start="2024-01-01", end="2025-01-01", status="active") -> ParsedRow:
    return ParsedRow(
        row_number=1, publisher_name=publisher, software_description=software,
        start_date=start, end_date=end, contract_number=contract, po_number=po,
        invoice_number="", contact_email="", supplier="", cost_centre="",
        license_type="subscription", license_metric="per_user",
        quantity="", sku_code="", unit_price="", line_total="",
        currency="EUR", notes=None, budget_owner_email="",
        external_ref=None, license_ref=None, parent_license_ref=None,
        portal_url=None, maintenance_coverage=None,
        import_status=status, validation_errors=[], warnings=[],
    )


def test_norm_text_casefolds_and_collapses_whitespace():
    assert _norm_text("  Acme  Corp  ") == "acme corp"


def test_norm_text_none_returns_empty():
    assert _norm_text(None) == ""


def test_dates_overlap_true():
    assert _dates_overlap("2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01")


def test_dates_overlap_false():
    assert not _dates_overlap("2023-01-01", "2023-12-31", "2024-01-01", "2024-12-31")


def test_match_duplicate_high_when_contract_po_date_match():
    row = _row()
    candidate = _row(publisher="Acme", software="Widget", contract="C1", po="P1",
                     start="2024-01-01", end="2025-01-01")
    candidate.row_number = 2
    result = _match_duplicate(row, candidate)
    assert result is not None
    severity, fields = result
    assert severity == "high"
    assert "contract_number" in fields


def test_match_duplicate_none_when_publisher_differs():
    row = _row()
    candidate = _row(publisher="Other Corp")
    candidate.row_number = 2
    assert _match_duplicate(row, candidate) is None


def test_match_fields_sentence_multiple():
    assert _match_fields_sentence(["publisher_name", "software_description"]) == \
        "Publisher, and software match."


def test_external_reference_matches_without_procurement_identity():
    row = _row(contract="", po="", start=None, end=None)
    candidate = _row(publisher="Other", software="Other", contract="", po="", start=None, end=None)
    row.external_ref = "  EXT-123  "
    candidate.external_ref = "ext-123"
    assert _match_duplicate(row, candidate) == ("high", ["external_ref"])


def test_blank_external_references_do_not_match():
    row = _row(contract="", po="", start=None, end=None)
    candidate = _row(contract="", po="", start=None, end=None)
    row.external_ref = "  "
    candidate.external_ref = None
    assert _match_duplicate(row, candidate) is None


def test_external_reference_warning_uses_public_label():
    assert _match_fields_sentence(["external_ref"]) == "External reference matches."

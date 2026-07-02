# backend/tests/test_unit/test_maintenance_parenting.py
"""Unit tests for maintenance parent inference."""
from app.services.import_.maintenance_parenting import (
    _strip_maintenance_suffix,
    _contract_parent_key,
    infer_batch_maintenance_parents,
)
from app.services.csv_importer import ParsedRow


def _row(row_number, publisher="Acme", software="Widget",
         license_type="subscription", contract="", po="",
         parent_ref=None, status="active") -> ParsedRow:
    return ParsedRow(
        row_number=row_number, publisher_name=publisher,
        software_description=software, start_date="2024-01-01",
        end_date="2025-01-01", contract_number=contract, po_number=po,
        invoice_number="", contact_email="", supplier="", cost_centre="",
        license_type=license_type, license_metric="per_user",
        quantity="", sku_code="", unit_price="", total_po_price="",
        currency="EUR", notes=None, budget_owner_email="",
        external_ref=None, license_ref=None,
        parent_license_ref=parent_ref,
        portal_url=None, maintenance_coverage=None,
        import_status=status, validation_errors=[], warnings=[],
    )


def test_strip_maintenance_suffix_removes_dash_maintenance():
    assert _strip_maintenance_suffix("Widget - Maintenance") == "widget"


def test_strip_maintenance_suffix_no_suffix_unchanged():
    assert _strip_maintenance_suffix("Widget") == "widget"


def test_contract_parent_key_strips_m_suffix():
    assert _contract_parent_key("C001-M") == "c001"


def test_infer_links_maintenance_to_perpetual():
    parent = _row(1, software="Widget", license_type="perpetual", contract="C1")
    maintenance = _row(2, software="Widget - Maintenance", license_type="maintenance", contract="C1")
    infer_batch_maintenance_parents([parent, maintenance])
    assert maintenance.parent_import_row_number == 1
    assert maintenance.import_status != "error"


def test_infer_errors_when_no_candidate():
    maintenance = _row(1, license_type="maintenance")
    infer_batch_maintenance_parents([maintenance])
    assert maintenance.import_status == "error"
    assert any("parent_license_ref" in e for e in maintenance.validation_errors)


def test_infer_errors_on_ambiguous_parents():
    parent_a = _row(1, software="Widget", license_type="perpetual", contract="C1")
    parent_b = _row(2, software="Widget", license_type="perpetual", contract="C1")
    maintenance = _row(3, software="Widget - Maintenance", license_type="maintenance", contract="C1")
    infer_batch_maintenance_parents([parent_a, parent_b, maintenance])
    assert maintenance.import_status == "error"
    assert any("ambiguous" in e for e in maintenance.validation_errors)

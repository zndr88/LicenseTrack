from datetime import date, timedelta
from types import SimpleNamespace

from app.models.license import LicenseMetric, LicenseType, MaintenanceCoverage
from app.services.report_export_service import build_report_export_csv
from app.services.reporting_service import ReportOptions, build_portfolio_stats, build_report_model


def make_license(**overrides):
    today = date.today()
    defaults = {
        "id": 1,
        "license_ref": "LT-2026-00001",
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "1",
        "unit_price": "100",
        "total_po_price": "",
        "po_total_override": None,
        "currency": "EUR",
        "start_date": today - timedelta(days=30),
        "end_date": today + timedelta(days=335),
        "maintenance_coverage": MaintenanceCoverage.unknown,
        "maintenance_start_date": None,
        "maintenance_end_date": None,
        "maintenance_cost": None,
        "is_retired": False,
        "lifecycle_status": None,
        "renewed_to_id": None,
        "is_completeness_exempt": False,
        "cost_centre": "IT",
        "supplier": "Supplier",
        "budget_owner_email": "owner@example.com",
        "po_number": "PO-1",
        "pending_order_id": None,
        "procurement_bundle_id": None,
        "parent_license_id": None,
        "maintenance_parent_links": [],
        "maintenance_child_links": [],
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_included_support_does_not_replace_perpetual_acquisition_spend():
    today = date.today()
    perpetual = make_license(
        license_type=LicenseType.perpetual,
        end_date=None,
        quantity="1",
        unit_price="1000",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_start_date=today - timedelta(days=30),
        maintenance_end_date=today + timedelta(days=334),
        maintenance_cost="120",
    )

    report = build_report_model([perpetual], ReportOptions())

    assert report.cost_overview["licenseSpendByCurrency"] == {"EUR": "1000"}
    assert report.cost_overview["recurringAnnualCostByCurrency"] == {"EUR": "120"}
    assert report.budget_forecast["baselineByCurrency"] == {"EUR": "120"}
    assert report.perpetual_maintenance_data["purchaseByCurrency"] == {"EUR": "1000"}


def test_period_report_does_not_prorate_included_support_parent_acquisition():
    today = date.today()
    perpetual = make_license(
        license_type=LicenseType.perpetual,
        end_date=None,
        unit_price="1000",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_start_date=today - timedelta(days=30),
        maintenance_end_date=today + timedelta(days=334),
        maintenance_cost="120",
    )
    options = ReportOptions(
        date_range="custom",
        date_from=today,
        date_to=today + timedelta(days=29),
    )

    report = build_report_model([perpetual], options)

    assert report.cost_overview["licenseSpendByCurrency"] == {"EUR": "1000"}
    assert report.cost_overview["recurringAnnualCostByCurrency"] == {"EUR": "9.863013698630136986301369863"}


def test_non_recurring_portfolio_has_no_forecast_and_counts_perpetual_as_active():
    perpetual = make_license(license_type=LicenseType.perpetual, end_date=None)

    report = build_report_model([perpetual], ReportOptions())
    stats = build_portfolio_stats([perpetual], {}, {perpetual.id: []})

    assert report.budget_forecast["forecastRows"] == []
    assert report.budget_forecast["singleCurrency"] is None
    assert stats.total_active == 1


def test_reused_po_text_is_reconciled_by_durable_identity_and_keeps_signed_difference():
    first = make_license(id=1, pending_order_id=10, quantity="1", unit_price="100", po_total_override="50")
    second = make_license(id=2, pending_order_id=20, quantity="1", unit_price="200")

    report = build_report_model([first, second], ReportOptions())

    rows = report.purchase_order_data["rows"]
    assert len(rows) == 2
    assert {row["identityKey"] for row in rows} == {"pending-order:10", "pending-order:20"}
    assert report.cost_overview["spendDifferenceByCurrency"] == {"EUR": "-50"}


def test_period_report_surfaces_undated_recurring_value_without_allocating_it():
    undated = make_license(start_date=None, end_date=None, quantity="2", unit_price="75")
    options = ReportOptions(
        date_range="custom",
        date_from=date.today(),
        date_to=date.today() + timedelta(days=30),
    )

    report = build_report_model([undated], options)

    assert report.cost_overview["licenseSpendByCurrency"] == {}
    assert report.cost_overview["unallocatedValuesByCurrency"] == {"EUR": "150"}
    assert report.counts.undated == 1


def test_included_support_coverage_creates_a_renewal_event():
    today = date.today()
    perpetual = make_license(
        license_type=LicenseType.perpetual,
        end_date=None,
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_start_date=today - timedelta(days=300),
        maintenance_end_date=today + timedelta(days=30),
        maintenance_cost="240",
    )

    report = build_report_model([perpetual], ReportOptions())
    events = [event for quarter in report.renewal_data for event in quarter["events"]]

    assert len(events) == 1
    assert events[0]["renewalKind"] == "included_support"
    assert events[0]["renewalValue"] == "240"


def test_report_csv_neutralizes_formula_like_text():
    report = build_report_model([make_license(publisher_name="=WEBSERVICE('bad')")], ReportOptions())

    content = build_report_export_csv(report)

    assert "'=WEBSERVICE('bad')" in content

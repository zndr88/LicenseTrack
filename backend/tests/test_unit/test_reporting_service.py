from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.models.license import LicenseMetric, LicenseType, MaintenanceCoverage
from app.services.report_export_service import build_report_export_csv
from app.services import reporting_service
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


def test_detailed_report_phase_contracts_remain_stable(monkeypatch):
    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 15)

    monkeypatch.setattr(reporting_service, "date", FixedDate)
    today = FixedDate.today()
    licenses = [
        make_license(
            id=1,
            pending_order_id=10,
            quantity="2",
            unit_price="100",
            po_total_override="450",
            start_date=today - timedelta(days=100),
            end_date=today + timedelta(days=30),
        ),
        make_license(
            id=2,
            license_ref="LT-2026-00002",
            publisher_name="Beta",
            software_description="Beta Cloud",
            license_type=LicenseType.saas,
            currency="USD",
            supplier="Cloud Vendor",
            cost_centre="FIN",
            po_number="PO-2",
            procurement_bundle_id="bundle-x",
            quantity="3",
            unit_price="50",
            start_date=today - timedelta(days=180),
            end_date=today + timedelta(days=184),
        ),
        make_license(
            id=3,
            license_ref="LT-2026-00003",
            publisher_name="Gamma",
            software_description="Gamma Server",
            license_type=LicenseType.perpetual,
            end_date=None,
            quantity="1",
            unit_price="1000",
            po_number="PO-3",
            maintenance_coverage=MaintenanceCoverage.included,
            maintenance_start_date=today - timedelta(days=305),
            maintenance_end_date=today + timedelta(days=59),
            maintenance_cost="1200",
        ),
        make_license(
            id=4,
            license_ref="LT-2026-00004",
            publisher_name="Gamma",
            software_description="Gamma Support",
            license_type=LicenseType.maintenance,
            parent_license_id=3,
            quantity="1",
            unit_price="300",
            total_po_price="300",
            po_number="PO-4",
            start_date=today - timedelta(days=274),
            end_date=today + timedelta(days=90),
            maintenance_cost="300",
        ),
    ]

    report = build_report_model(
        licenses,
        ReportOptions(forecast_years=2, annual_uplift_pct=Decimal("10")),
    )

    assert report.counts.model_dump() == {
        "records": 4,
        "total_records": 4,
        "active": 2,
        "upcoming": 1,
        "expiring": 1,
        "expired": 0,
        "unpriced": 0,
        "excluded": 0,
        "undated": 0,
        "unallocated": 0,
    }
    assert report.financial_summaries == {
        "licenseSpendByCurrency": {"EUR": "1500", "USD": "150"},
        "poSpendByCurrency": {"EUR": "1750", "USD": "150"},
        "spendDifferenceByCurrency": {"EUR": "250", "USD": "0"},
        "recurringAnnualCostByCurrency": {"EUR": "500", "USD": "150"},
        "lifecycleBudgetByStatus": {
            "active": {"USD": "150", "EUR": "300"},
            "expiring": {"EUR": "200"},
            "expired": {},
        },
        "unallocatedValuesByCurrency": {},
    }
    assert report.budget_forecast["baselineByCurrency"] == {"EUR": "500", "USD": "150"}
    assert report.budget_forecast["singleCurrency"] is None
    assert report.budget_forecast["forecastRows"] == []
    assert [
        (row["licenseId"], row["annualCost"], row["costSource"])
        for row in report.budget_forecast["recurringRecords"]
    ] == [(4, "300", "line"), (1, "200", "line"), (2, "150", "line")]
    assert [
        (row["identityKey"], row["lineValue"], row["poValue"], row["difference"], row["status"])
        for row in report.purchase_order_data["rows"]
    ] == [
        ("po:po-3", "1000", "1000", "0", "reconciled"),
        ("pending-order:10", "200", "450", "250", "override"),
        ("po:po-4", "300", "300", "0", "reconciled"),
        ("procurement-bundle:bundle-x", "150", "150", "0", "reconciled"),
    ]
    assert report.purchase_order_data["totalsByCurrency"] == {"EUR": "1750", "USD": "150"}
    assert report.purchase_order_data["lineTotalsByCurrency"] == {"EUR": "1500", "USD": "150"}
    assert [
        (
            quarter["quarterLabel"],
            quarter["count"],
            quarter["estimatedValueByCurrency"],
            [(event["licenseId"], event["renewalKind"], event["renewalValue"]) for event in quarter["events"]],
        )
        for quarter in report.renewal_data
    ] == [
        ("Q2 2026", 0, {}, []),
        (
            "Q3 2026",
            3,
            {"EUR": "1700"},
            [(1, "license_term", "200"), (3, "included_support", "1200"), (4, "maintenance_record", "300")],
        ),
        ("Q4 2026", 1, {"USD": "150"}, [(2, "license_term", "150")]),
        ("Q1 2027", 0, {}, []),
    ]
    assert report.perpetual_maintenance_data["purchaseByCurrency"] == {"EUR": "1000"}
    assert report.perpetual_maintenance_data["maintenanceByCurrency"] == {"EUR": "1500"}
    assert report.perpetual_maintenance_data["totalByCurrency"] == {"EUR": "2500"}
    assert report.perpetual_maintenance_data["rows"][0]["maintenanceSource"] == "included"
    assert report.perpetual_maintenance_data["rows"][0]["maintenanceRecords"][0]["amount"] == "300"


def test_report_csv_neutralizes_formula_like_text():
    report = build_report_model([make_license(publisher_name="=WEBSERVICE('bad')")], ReportOptions())

    content = build_report_export_csv(report)

    assert "'=WEBSERVICE('bad')" in content

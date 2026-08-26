"""CSV serialization for the authoritative report response."""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable

from app.schemas.report import DetailedReportResponse
from app.services.csv_safety import safe_csv_row


HEADERS = [
    "Report Type",
    "Row Type",
    "Record ID",
    "Identity Key",
    "Identity Type",
    "Publisher",
    "Supplier",
    "Description",
    "License Type",
    "Currency",
    "Amount",
    "Secondary Amount",
    "Difference",
    "Count",
    "Status",
    "Event Date",
    "Start Date",
    "End Date",
    "Cost Centre",
    "Notes",
]


def _date(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _row(report_type: str, row_type: str, **values: Any) -> list[Any]:
    return [
        report_type,
        row_type,
        values.get("record_id", ""),
        values.get("identity_key", ""),
        values.get("identity_type", ""),
        values.get("publisher", ""),
        values.get("supplier", ""),
        values.get("description", ""),
        values.get("license_type", ""),
        values.get("currency", ""),
        values.get("amount", ""),
        values.get("secondary_amount", ""),
        values.get("difference", ""),
        values.get("count", ""),
        values.get("status", ""),
        _date(values.get("event_date")),
        _date(values.get("start_date")),
        _date(values.get("end_date")),
        values.get("cost_centre", ""),
        values.get("notes", ""),
    ]


def _summary_rows(report: DetailedReportResponse) -> Iterable[list[Any]]:
    summaries = report.financial_summaries
    for name, key in (
        ("license_spend", "licenseSpendByCurrency"),
        ("po_spend", "poSpendByCurrency"),
        ("difference", "spendDifferenceByCurrency"),
        ("recurring_baseline", "recurringAnnualCostByCurrency"),
        ("unallocated_undated", "unallocatedValuesByCurrency"),
    ):
        for currency, amount in (summaries.get(key, {}) or {}).items():
            yield _row("summary", name, currency=currency, amount=amount)
    for name, count in report.counts.model_dump(by_alias=False).items():
        yield _row("summary", name, count=count)


def build_report_export_csv(report: DetailedReportResponse) -> str:
    """Return one complete, formula-safe CSV containing every report dataset."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    writer.writerows(safe_csv_row(row) for row in _summary_rows(report))

    forecast = report.budget_forecast
    for item in forecast.get("recurringRecords", []) or []:
        writer.writerow(safe_csv_row(_row(
            "budget_forecast", "recurring_record",
            record_id=item.get("licenseId"), publisher=item.get("publisher"),
            supplier=item.get("supplier"), description=item.get("softwareDescription"),
            license_type=item.get("licenseType"), currency=item.get("currency"),
            amount=item.get("annualCost"), cost_centre=item.get("costCentre"),
            status=item.get("costSource"),
            start_date=item.get("startDate"), end_date=item.get("endDate"),
        )))
    for item in forecast.get("forecastRows", []) or []:
        writer.writerow(safe_csv_row(_row(
            "budget_forecast", "forecast_year", count=item.get("year"),
            amount=item.get("projectedBudget"), secondary_amount=item.get("baseline"),
            difference=item.get("growthAmount"),
        )))

    for item in report.publisher_data:
        currencies = list((item.get("totalSpendByCurrency", {}) or {}).items()) or [("", "")]
        for currency, amount in currencies:
            writer.writerow(safe_csv_row(_row(
                "publisher", "publisher_currency", publisher=item.get("publisher"),
                currency=currency, amount=amount, count=item.get("licenseCount"),
                notes="unpriced records present" if item.get("hasUnpricedLicenses") else "",
            )))
    for item in report.vendor_data:
        currencies = list((item.get("totalSpendByCurrency", {}) or {}).items()) or [("", "")]
        for currency, amount in currencies:
            writer.writerow(safe_csv_row(_row(
                "vendor", "vendor_currency", publisher=item.get("publisher"),
                supplier=item.get("supplier"), currency=currency, amount=amount,
                count=item.get("licenseCount"),
            )))

    for row_type, items in (("license_type", report.portfolio_data.get("byType", [])), ("license_metric", report.portfolio_data.get("byMetric", []))):
        for item in items or []:
            writer.writerow(safe_csv_row(_row("portfolio", row_type, description=item.get("name"), count=item.get("value"))))

    for quarter in report.renewal_data:
        for event in quarter.get("events", []) or []:
            writer.writerow(safe_csv_row(_row(
                "renewal", quarter.get("quarterLabel", "quarter"),
                record_id=event.get("licenseId"), publisher=event.get("publisher"),
                description=event.get("softwareDescription"), currency=event.get("currency"),
                amount=event.get("renewalValue"), event_date=event.get("eventDate"),
                status=event.get("renewalKind"), notes=event.get("valueSource"),
            )))

    maintenance = report.perpetual_maintenance_data
    for item in maintenance.get("rows", []) or []:
        currencies = list((item.get("maintenanceByCurrency", {}) or {}).items()) or [(item.get("currency", ""), "")]
        for currency, amount in currencies:
            writer.writerow(safe_csv_row(_row(
                "perpetual_maintenance", "perpetual", record_id=item.get("licenseId"),
                publisher=item.get("publisher"), description=item.get("description"),
                currency=currency, amount=amount, secondary_amount=item.get("purchaseValue"),
                status=item.get("maintenanceSource"),
                start_date=item.get("startDate"), end_date=item.get("endDate"),
            )))
        for child in item.get("maintenanceRecords", []) or []:
            writer.writerow(safe_csv_row(_row(
                "perpetual_maintenance", "maintenance_record", record_id=child.get("licenseId"),
                publisher=child.get("publisher"), description=child.get("description"),
                currency=child.get("currency"), amount=child.get("amount"),
                status="maintenance_record", start_date=child.get("startDate"), end_date=child.get("endDate"),
            )))

    for item in report.purchase_order_data.get("rows", []) or []:
        writer.writerow(safe_csv_row(_row(
            "purchase_order", "procurement_identity", identity_key=item.get("identityKey"),
            identity_type=item.get("identityType"), publisher=item.get("publisher"),
            currency=item.get("currency"), amount=item.get("poValue"),
            secondary_amount=item.get("lineValue"), difference=item.get("difference"),
            count=item.get("lineCount"), status=item.get("status"),
            notes=f"PO number: {item.get('poNumber') or 'none'}",
        )))

    output.seek(0)
    return output.getvalue()

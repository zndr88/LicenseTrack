"""Authoritative financial reporting read model.

This module is deliberately independent from the report page.  It loads the
viewer-scoped portfolio once, applies one set of date/eligibility rules, and
keeps all money arithmetic in Decimal until the response is serialized.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.models.user import User
from app.schemas.report import DetailedReportResponse, PortfolioStatsResponse
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.license_service import (
    annualize_term_cost,
    calc_line_total,
    compute_completeness,
    compute_expiration_status,
)
from app.services.money import MoneyParseError, parse_money
from app.services.po_total_override_service import procurement_identity_key


RECURRING_TYPES = frozenset({LicenseType.subscription, LicenseType.saas, LicenseType.maintenance})
SUPPORT_PARENT_TYPES = frozenset({LicenseType.freeware, LicenseType.perpetual, LicenseType.oem})
ZERO = Decimal("0")


@dataclass(frozen=True)
class ReportOptions:
    include_retired: bool = False
    date_range: str = "all"
    date_from: date | None = None
    date_to: date | None = None
    cost_centres: tuple[str, ...] = ()
    forecast_years: int = 5
    annual_uplift_pct: Decimal = ZERO
    fiscal_year_start_month: int = 1
    notification_days: int = 30


def _money(raw: object) -> Decimal | None:
    try:
        return parse_money(str(raw) if raw is not None else None)
    except (MoneyParseError, InvalidOperation, ValueError):
        return None


def _fmt(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _currency(license_obj: License) -> str:
    return (license_obj.currency or "USD").strip().upper() or "USD"


def _add(target: dict[str, Decimal], currency: str, value: Decimal | None) -> None:
    if value is not None:
        target[currency] = target.get(currency, ZERO) + value


def _serialize_map(values: dict[str, Decimal]) -> dict[str, str]:
    return {currency: _fmt(amount) or "0" for currency, amount in sorted(values.items())}


def _range(options: ReportOptions) -> tuple[date, date] | None:
    if options.date_range == "all":
        return None
    if options.date_range == "thisYear":
        year = date.today().year
        return date(year, 1, 1), date(year, 12, 31)
    if options.date_range == "last12":
        today = date.today()
        try:
            from_date = today.replace(year=today.year - 1)
        except ValueError:
            from_date = today.replace(year=today.year - 1, day=28)
        return from_date, today
    if options.date_range == "custom" and options.date_from and options.date_to:
        return options.date_from, options.date_to
    return None


def _term(license_obj: License) -> tuple[date, date] | None:
    if (
        license_obj.license_type in SUPPORT_PARENT_TYPES
        and license_obj.maintenance_coverage == MaintenanceCoverage.included
    ):
        start, end = license_obj.maintenance_start_date, license_obj.maintenance_end_date
    else:
        start, end = license_obj.start_date, license_obj.end_date
    if start is None or end is None or end < start:
        return None
    return start, end


def _overlaps(license_obj: License, selected: tuple[date, date] | None) -> bool:
    if selected is None:
        return True
    if _is_recurring(license_obj):
        term = _term(license_obj)
        if term is None:
            return True
        start, end = term
        return start <= selected[1] and end >= selected[0]
    start, end = license_obj.start_date, license_obj.end_date
    if start and end:
        return start <= selected[1] and end >= selected[0]
    if start:
        return start <= selected[1]
    if end:
        return end >= selected[0]
    return True


def _visible(license_obj: License, options: ReportOptions, selected: tuple[date, date] | None) -> bool:
    if not options.include_retired and (
        license_obj.is_retired or license_obj.lifecycle_status == "legacy"
    ):
        return False
    if options.cost_centres and (license_obj.cost_centre or "") not in options.cost_centres:
        return False
    return _overlaps(license_obj, selected)


def _is_paid_included_support(license_obj: License) -> bool:
    if (
        license_obj.license_type not in SUPPORT_PARENT_TYPES
        or license_obj.maintenance_coverage != MaintenanceCoverage.included
    ):
        return False
    return (_money(license_obj.maintenance_cost) or ZERO) > ZERO


def _has_included_support_record(license_obj: License) -> bool:
    return (
        license_obj.license_type in SUPPORT_PARENT_TYPES
        and license_obj.maintenance_coverage == MaintenanceCoverage.included
        and bool(str(license_obj.maintenance_cost or "").strip())
    )


def _is_recurring(license_obj: License) -> bool:
    return license_obj.license_type in RECURRING_TYPES or _has_included_support_record(license_obj)


def _is_recurring_line_value(license_obj: License) -> bool:
    """Whether the license line itself represents the recurring charge."""
    return license_obj.license_type in RECURRING_TYPES or (
        license_obj.license_type == LicenseType.freeware
        and _has_included_support_record(license_obj)
    )


def _line_value(license_obj: License) -> tuple[Decimal | None, str]:
    if license_obj.license_type == LicenseType.freeware and _has_included_support_record(license_obj):
        support = _money(license_obj.maintenance_cost)
        return (support, "included_support") if support is not None else (None, "missing")
    if license_obj.license_type == LicenseType.freeware:
        return ZERO, "excluded"
    value = calc_line_total(license_obj.quantity, license_obj.unit_price)
    return (value, "line") if value is not None else (None, "missing")


def _calculated_value(license_obj: License) -> tuple[Decimal | None, str]:
    value, source = _line_value(license_obj)
    if value is not None or source == "excluded":
        return value, source
    stored = _money(license_obj.total_po_price)
    return (stored, "legacy_po_fallback") if stored is not None else (None, "missing")


def _allocation(
    license_obj: License,
    value: Decimal | None,
    selected: tuple[date, date] | None,
    *,
    recurring_value: bool | None = None,
) -> tuple[Decimal | None, str]:
    if value is None:
        return None, "unpriced"
    should_allocate = _is_recurring_line_value(license_obj) if recurring_value is None else recurring_value
    if selected is None or not should_allocate:
        return value, "full"
    term = _term(license_obj)
    if term is None:
        return None, "undated"
    start, end = term
    overlap_start, overlap_end = max(start, selected[0]), min(end, selected[1])
    if overlap_end < overlap_start:
        return ZERO, "outside"
    term_days = Decimal((end - start).days + 1)
    overlap_days = Decimal((overlap_end - overlap_start).days + 1)
    return value * overlap_days / term_days, "allocated"


def _annual_recurring_value(license_obj: License) -> tuple[Decimal | None, str]:
    if not _is_recurring(license_obj):
        return ZERO, "not_recurring"
    if _has_included_support_record(license_obj):
        amount = _money(license_obj.maintenance_cost)
    else:
        amount = calc_line_total(license_obj.quantity, license_obj.unit_price)
    if amount is None:
        return None, "missing"
    start_end = _term(license_obj)
    return annualize_term_cost(amount, *(start_end or (None, None))), "annualized"


def _recurring_term_value(license_obj: License) -> tuple[Decimal | None, str]:
    """Return the complete recurring term value without replacing acquisition spend."""
    if _has_included_support_record(license_obj):
        amount = _money(license_obj.maintenance_cost)
        return (amount, "included_support") if amount is not None else (None, "missing")
    value = calc_line_total(license_obj.quantity, license_obj.unit_price)
    return (value, "line") if value is not None else (None, "missing")


def _current_baseline_eligible(license_obj: License, today: date) -> bool:
    if not _is_recurring(license_obj):
        return False
    if license_obj.is_retired or license_obj.lifecycle_status in {"legacy", "renewed", "pending_renewal"}:
        return False
    status = compute_expiration_status(license_obj, today)
    if status not in {"active", "expiring", "perpetual"}:
        return False
    if _has_included_support_record(license_obj):
        return (
            (license_obj.maintenance_start_date is None or license_obj.maintenance_start_date <= today)
            and (license_obj.maintenance_end_date is None or license_obj.maintenance_end_date >= today)
        )
    return True


def _identity(license_obj: License) -> tuple[str, str]:
    return procurement_identity_key(
        license_id=license_obj.id,
        pending_order_id=license_obj.pending_order_id,
        procurement_bundle_id=license_obj.procurement_bundle_id,
        po_number=license_obj.po_number,
        currency=_currency(license_obj),
    ) or (f"unkeyed:{license_obj.id}", _currency(license_obj))


def _renewal_quarters(fiscal_month: int, today: date) -> list[dict]:
    fiscal_start = fiscal_month - 1
    offset = (today.month - 1 - fiscal_start) % 12
    current_q = offset // 3
    q_month = fiscal_start + current_q * 3
    q_year = today.year + (q_month // 12)
    q_month %= 12
    if q_month > today.month - 1:
        q_year -= 1
    result = []
    for index in range(4):
        raw_month = q_month + index * 3
        start_month = raw_month % 12
        start_year = q_year + raw_month // 12
        from_date = date(start_year, start_month + 1, 1)
        next_month = start_month + 3
        to_date = date(start_year + next_month // 12, next_month % 12 + 1, 1) - timedelta(days=1)
        quarter = (current_q + index) % 4 + 1
        result.append({"quarter_label": f"Q{quarter} {start_year}", "from": from_date, "to": to_date, "count": 0, "value": {}, "events": []})
    return result


async def _load_licenses(db: AsyncSession, user: User) -> list[License]:
    departments = await get_viewer_departments(user.id, db) if user.role == "viewer" else None
    query = select(License).options(
        selectinload(License.maintenance_parent_links),
        selectinload(License.maintenance_child_links),
    )
    query = apply_department_filter(query, departments).order_by(License.id)
    result = await db.execute(query)
    return list(result.scalars().all())


def _money_issue_counts(licenses: list[License]) -> tuple[int, int]:
    unpriced = 0
    excluded = 0
    for license_obj in licenses:
        if license_obj.license_type == LicenseType.freeware and not _has_included_support_record(license_obj):
            continue
        if license_obj.license_type == LicenseType.freeware:
            relevant = [license_obj.maintenance_cost]
        else:
            relevant = [license_obj.quantity, license_obj.unit_price]
            if _has_included_support_record(license_obj):
                relevant.append(license_obj.maintenance_cost)
        relevant.append(license_obj.po_total_override)
        if _line_value(license_obj)[0] is None:
            relevant.append(license_obj.total_po_price)
        invalid = any(
            raw is not None and str(raw).strip() != "" and _money(raw) is None
            for raw in relevant
        )
        if invalid:
            excluded += 1
        elif _line_value(license_obj)[0] is None:
            unpriced += 1
    return unpriced, excluded


def _serialize_common_row(row: dict) -> dict:
    if isinstance(row, Decimal):
        return _fmt(row)
    if isinstance(row, dict):
        return {
            key if "_" not in key else key.split("_")[0] + "".join(part.capitalize() for part in key.split("_")[1:]): _serialize_common_row(value)
            for key, value in row.items()
        }
    if isinstance(row, list):
        return [_serialize_common_row(value) for value in row]
    return row


def build_report_model(licenses: list[License], options: ReportOptions) -> DetailedReportResponse:
    selected = _range(options)
    today = date.today()
    visible = [license_obj for license_obj in licenses if _visible(license_obj, options, selected)]
    unpriced_count, excluded_count = _money_issue_counts(visible)

    lifecycle_counts = {"active": 0, "upcoming": 0, "expiring": 0, "expired": 0}
    license_spend: dict[str, Decimal] = {}
    po_spend: dict[str, Decimal] = {}
    difference: dict[str, Decimal] = {}
    recurring_amount: dict[str, Decimal] = {}
    forecast_baseline: dict[str, Decimal] = {}
    lifecycle_budget = {"active": {}, "expiring": {}, "expired": {}}
    unallocated_values: dict[str, Decimal] = {}
    po_groups: dict[tuple[str, str], dict] = {}
    publisher_groups: dict[str, dict] = {}
    vendor_groups: dict[tuple[str, str], dict] = {}
    recurring_records: list[dict] = []
    recurring_contributor_count = 0
    undated_count = 0

    for license_obj in visible:
        status = compute_expiration_status(license_obj, today, options.notification_days)
        if status in {"active", "perpetual"}:
            lifecycle_counts["active"] += 1
        elif status == "upcoming":
            lifecycle_counts["upcoming"] += 1
        elif status == "expiring":
            lifecycle_counts["expiring"] += 1
        elif status == "expired":
            lifecycle_counts["expired"] += 1

        line_value, line_source = _line_value(license_obj)
        allocated_line, allocation_status = _allocation(license_obj, line_value, selected)
        currency = _currency(license_obj)
        if allocation_status == "undated":
            undated_count += 1
            if line_value is not None:
                _add(unallocated_values, currency, line_value)
        elif allocated_line is not None and line_source != "excluded":
            _add(license_spend, currency, allocated_line)
        if selected is not None and _is_recurring(license_obj) and _term(license_obj) is None and allocation_status != "undated":
            undated_count += 1
            if line_value is not None:
                _add(unallocated_values, currency, line_value)

        calculated, calculated_source = _calculated_value(license_obj)
        allocated_calculated, calculated_status = _allocation(license_obj, calculated, selected)
        if calculated_status == "undated":
            pass
        elif allocated_calculated is not None and calculated_source != "excluded":
            lifecycle_status = "active" if status == "perpetual" else status
            if lifecycle_status in lifecycle_budget:
                _add(lifecycle_budget[lifecycle_status], currency, allocated_calculated)

        if line_source != "excluded":
            identity, identity_currency = _identity(license_obj)
            group_key = (identity, identity_currency)
            group = po_groups.setdefault(group_key, {
                "identity_key": identity,
                "identity_type": "pending_order" if identity.startswith("pending-order:") else "procurement_bundle" if identity.startswith("procurement-bundle:") else "po_number" if identity.startswith("po:") else "unkeyed",
                "po_number": (license_obj.po_number or "").strip() or None,
                "currency": currency,
                "publisher_names": [],
                "line_count": 0,
                "priced_line_count": 0,
                "line_value": ZERO,
                "override": None,
                "has_undated": False,
            })
            group["line_count"] += 1
            if license_obj.publisher_name and license_obj.publisher_name not in group["publisher_names"]:
                group["publisher_names"].append(license_obj.publisher_name)
            if allocated_line is not None:
                group["priced_line_count"] += 1
                group["line_value"] += allocated_line
            if selected is not None and _is_recurring(license_obj) and _term(license_obj) is None:
                group["has_undated"] = True
            override = _money(license_obj.po_total_override)
            if group["override"] is None and override is not None:
                group["override"] = override

        publisher = license_obj.publisher_name or "Unknown"
        publisher_group = publisher_groups.setdefault(publisher, {"publisher": publisher, "total_spend_by_currency": {}, "total_spend": ZERO, "license_count": 0, "has_unpriced_licenses": False})
        publisher_group["license_count"] += 1
        if allocated_calculated is not None and calculated_source != "excluded":
            _add(publisher_group["total_spend_by_currency"], currency, allocated_calculated)
            publisher_group["total_spend"] += allocated_calculated
        elif calculated_source == "missing":
            publisher_group["has_unpriced_licenses"] = True

        supplier = license_obj.supplier or ""
        vendor_group = vendor_groups.setdefault((publisher, supplier), {"publisher": publisher, "supplier": supplier, "license_count": 0, "total_spend_by_currency": {}, "total_spend": ZERO, "has_unpriced_licenses": False})
        vendor_group["license_count"] += 1
        if allocated_calculated is not None and calculated_source != "excluded":
            _add(vendor_group["total_spend_by_currency"], currency, allocated_calculated)
            vendor_group["total_spend"] += allocated_calculated
        elif calculated_source == "missing":
            vendor_group["has_unpriced_licenses"] = True

        recurring_value = None
        recurring_source = "missing"
        if selected is None and _current_baseline_eligible(license_obj, today):
            recurring_value, recurring_source = _annual_recurring_value(license_obj)
        elif selected is not None and _is_recurring(license_obj):
            recurring_term_value, recurring_term_source = _recurring_term_value(license_obj)
            recurring_value, recurring_status = _allocation(
                license_obj,
                recurring_term_value,
                selected,
                recurring_value=True,
            )
            recurring_source = "allocated" if recurring_status == "allocated" else recurring_status
        if recurring_value is not None and recurring_source not in {"missing", "outside", "undated", "not_recurring"}:
            _add(recurring_amount, currency, recurring_value)
            recurring_contributor_count += 1

        if _current_baseline_eligible(license_obj, today):
            annual_value, annual_source = _annual_recurring_value(license_obj)
            if annual_value is not None and annual_source != "not_recurring":
                _add(forecast_baseline, currency, annual_value)
                recurring_records.append({
                    "license_id": license_obj.id,
                    "publisher": publisher,
                    "software_description": license_obj.software_description or "",
                    "supplier": supplier,
                    "budget_owner_email": license_obj.budget_owner_email or "",
                    "cost_centre": license_obj.cost_centre or "",
                    "license_type": license_obj.license_type.value,
                    "currency": currency,
                    "annual_cost": annual_value,
                    "cost_source": "included_support" if _has_included_support_record(license_obj) else "line",
                    "start_date": _term(license_obj)[0] if _term(license_obj) else None,
                    "end_date": _term(license_obj)[1] if _term(license_obj) else None,
                })

    for group in po_groups.values():
        value = group["override"] if group["override"] is not None else group["line_value"]
        if selected is not None and group["has_undated"] and group["override"] is not None:
            value = None
        _add(po_spend, group["currency"], value)
        publisher_names = group["publisher_names"]
        difference_value = value - group["line_value"] if value is not None else None
        if difference_value is not None:
            difference[group["currency"]] = difference.get(group["currency"], ZERO) + difference_value
        group["po_value"] = value
        group["difference"] = difference_value
        group["publisher"] = "Unknown publisher" if not publisher_names else publisher_names[0] if len(publisher_names) == 1 else "Multiple publishers"
        group["status"] = "unallocated" if value is None else "unkeyed" if group["identity_type"] == "unkeyed" else "override" if group["override"] is not None and difference_value != ZERO else "reconciled" if difference_value == ZERO else "difference"
        group.pop("publisher_names")
        group.pop("has_undated")

    baseline_by_currency = dict(forecast_baseline)
    baseline_currencies = sorted(currency for currency, amount in baseline_by_currency.items() if amount > ZERO)
    single_currency = baseline_currencies[0] if len(baseline_currencies) == 1 else None
    growth = max(options.annual_uplift_pct, ZERO) / Decimal("100")
    forecast_rows = []
    if single_currency:
        baseline = baseline_by_currency[single_currency]
        for index in range(options.forecast_years):
            projected = baseline * ((Decimal("1") + growth) ** index)
            forecast_rows.append({"year": today.year + index + 1, "baseline": baseline, "growth_amount": projected - baseline, "projected_budget": projected})

    portfolio_type: dict[str, int] = defaultdict(int)
    portfolio_metric: dict[str, int] = defaultdict(int)
    for license_obj in visible:
        portfolio_type[license_obj.license_type.value] += 1
        portfolio_metric[license_obj.license_metric.value] += 1

    renewal_quarters = _renewal_quarters(options.fiscal_year_start_month, today)
    for license_obj in visible:
        if license_obj.is_retired or license_obj.lifecycle_status in {"legacy", "renewed", "pending_renewal"}:
            continue
        if license_obj.license_type == LicenseType.maintenance:
            event_date = license_obj.end_date
            maintenance_value = _money(license_obj.maintenance_cost)
            if maintenance_value is None:
                maintenance_value = _line_value(license_obj)[0]
            value = annualize_term_cost(maintenance_value, license_obj.start_date, license_obj.end_date) if maintenance_value is not None else None
            value_source = "maintenance_record"
            renewal_kind = "maintenance_record"
        elif license_obj.license_type in {LicenseType.subscription, LicenseType.saas}:
            event_date = license_obj.end_date
            value, value_source = _annual_recurring_value(license_obj)
            renewal_kind = "license_term"
        elif _is_paid_included_support(license_obj):
            event_date = license_obj.maintenance_end_date
            value, value_source = _annual_recurring_value(license_obj)
            renewal_kind = "included_support"
        else:
            continue
        if event_date is None or event_date < today:
            continue
        for quarter in renewal_quarters:
            if quarter["from"] <= event_date <= quarter["to"]:
                quarter["count"] += 1
                if value is not None:
                    _add(quarter["value"], _currency(license_obj), value)
                event = {
                    "license_id": license_obj.id,
                    "license_ref": license_obj.license_ref,
                    "publisher": license_obj.publisher_name or "Unknown",
                    "software_description": license_obj.software_description or "",
                    "renewal_kind": renewal_kind,
                    "event_date": event_date,
                    "currency": _currency(license_obj),
                    "renewal_value": value,
                    "value_source": value_source,
                }
                quarter["events"].append(event)
                break

    maintenance_by_parent: dict[int, list[License]] = defaultdict(list)
    maintenance_by_id = {license_obj.id: license_obj for license_obj in visible if license_obj.license_type == LicenseType.maintenance}
    for maintenance in maintenance_by_id.values():
        parent_ids = {maintenance.parent_license_id}
        parent_ids.update(link.parent_license_id for link in getattr(maintenance, "maintenance_parent_links", []) or [])
        for parent_id in filter(None, parent_ids):
            maintenance_by_parent[parent_id].append(maintenance)

    purchase_by_currency: dict[str, Decimal] = {}
    maintenance_totals: dict[str, Decimal] = {}
    total_by_currency: dict[str, Decimal] = {}
    perpetual_rows = []
    counted_maintenance: set[int] = set()
    for license_obj in visible:
        if license_obj.license_type != LicenseType.perpetual:
            continue
        purchase, purchase_source = _calculated_value(license_obj)
        currency = _currency(license_obj)
        maintenance_by_currency: dict[str, Decimal] = {}
        records = maintenance_by_parent.get(license_obj.id, [])
        if license_obj.maintenance_coverage == MaintenanceCoverage.included:
            support = _money(license_obj.maintenance_cost)
            if support is not None:
                _add(maintenance_by_currency, currency, support)
                _add(maintenance_totals, currency, support)
                _add(total_by_currency, currency, support)
            maintenance_source = "included" if support is not None else "included_missing"
        elif records:
            for record in records:
                record_value, _ = _calculated_value(record)
                if record_value is not None:
                    _add(maintenance_by_currency, _currency(record), record_value)
            maintenance_source = "separately_tracked" if maintenance_by_currency else "separate_missing"
        else:
            maintenance_source = "not_tracked"
        if purchase is not None:
            _add(purchase_by_currency, currency, purchase)
            _add(total_by_currency, currency, purchase)
        for maintenance_currency, amount in maintenance_by_currency.items():
            for record in records:
                if _currency(record) == maintenance_currency and record.id not in counted_maintenance:
                    counted_maintenance.add(record.id)
                    _add(maintenance_totals, maintenance_currency, _calculated_value(record)[0])
                    _add(total_by_currency, maintenance_currency, _calculated_value(record)[0])
        perpetual_rows.append({
            "license_id": license_obj.id,
            "publisher": license_obj.publisher_name or "Unknown",
            "description": license_obj.software_description or "",
            "po_number": license_obj.po_number or "",
            "currency": currency,
            "purchase_value": purchase,
            "purchase_source": purchase_source,
            "maintenance_by_currency": maintenance_by_currency,
            "maintenance_source": maintenance_source,
            "linked_maintenance_count": len(records),
            "start_date": _term(license_obj)[0] if _term(license_obj) else license_obj.start_date,
            "end_date": _term(license_obj)[1] if _term(license_obj) else license_obj.end_date,
            "maintenance_records": [
                {"license_id": record.id, "publisher": record.publisher_name or "Unknown", "description": record.software_description or "", "currency": _currency(record), "amount": _calculated_value(record)[0], "po_number": record.po_number or "", "start_date": record.start_date, "end_date": record.end_date}
                for record in records
            ],
        })

    financial_summaries = {
        "license_spend_by_currency": _serialize_map(license_spend),
        "po_spend_by_currency": _serialize_map(po_spend),
        "spend_difference_by_currency": _serialize_map(difference),
        "recurring_annual_cost_by_currency": _serialize_map(recurring_amount),
        "lifecycle_budget_by_status": {status: _serialize_map(values) for status, values in lifecycle_budget.items()},
        "unallocated_values_by_currency": _serialize_map(unallocated_values),
    }
    sorted_po_groups = sorted(
        po_groups.values(),
        key=lambda row: (-(row["po_value"] or ZERO), row["currency"], row["identity_key"]),
    )
    po_rows = [_serialize_common_row(group) for group in sorted_po_groups]
    publisher_rows = [_serialize_common_row(row) for row in sorted(publisher_groups.values(), key=lambda row: row["total_spend"], reverse=True)]
    vendor_rows = [_serialize_common_row(row) for row in sorted(vendor_groups.values(), key=lambda row: row["total_spend"], reverse=True)]
    recurring_records.sort(key=lambda row: row["annual_cost"], reverse=True)
    counts = {
        "records": len(visible),
        "total_records": len(licenses),
        **lifecycle_counts,
        "unpriced": unpriced_count,
        "excluded": excluded_count,
        "undated": undated_count,
        "unallocated": undated_count,
    }
    response = {
        "generated_at": datetime.now().astimezone(),
        "filters": {
            "include_retired": options.include_retired,
            "date_range": options.date_range,
            "date_from": options.date_from,
            "date_to": options.date_to,
            "cost_centres": list(options.cost_centres),
            "forecast_years": options.forecast_years,
            "annual_uplift_pct": _fmt(options.annual_uplift_pct) or "0",
            "fiscal_year_start_month": options.fiscal_year_start_month,
        },
        "available_cost_centres": sorted({license_obj.cost_centre for license_obj in licenses if license_obj.cost_centre}),
        "currency_disclaimer": "All monetary values remain in their native currencies. No currency conversion is applied.",
        "counts": counts,
        "financial_summaries": _serialize_common_row(financial_summaries),
        "cost_overview": _serialize_common_row({
            **financial_summaries,
            "recurring_count": recurring_contributor_count,
            "po_count": sum(1 for row in sorted_po_groups if row["identity_type"] != "unkeyed"),
            "overridden_po_count": sum(1 for row in sorted_po_groups if row["override"] is not None),
            "unkeyed_count": sum(
                row["line_count"] for row in sorted_po_groups if row["identity_type"] == "unkeyed"
            ),
            "unpriced_count": unpriced_count,
            "excluded_count": excluded_count,
            "undated_count": undated_count,
            "is_period_allocated": selected is not None,
        }),
        "budget_forecast": _serialize_common_row({
            "forecast_rows": [_serialize_common_row(row) for row in forecast_rows],
            "recurring_records": [_serialize_common_row(row) for row in recurring_records],
            "baseline_by_currency": _serialize_map(baseline_by_currency),
            "single_currency": single_currency,
            "fallback_count": 0,
        }),
        "publisher_data": publisher_rows,
        "vendor_data": vendor_rows,
        "portfolio_data": _serialize_common_row({
            "by_type": [{"name": key, "value": value} for key, value in sorted(portfolio_type.items(), key=lambda item: item[1], reverse=True)],
            "by_metric": [{"name": key, "value": value} for key, value in sorted(portfolio_metric.items(), key=lambda item: item[1], reverse=True)],
        }),
        "renewal_data": _serialize_common_row([
            {"quarter_label": quarter["quarter_label"], "count": quarter["count"], "estimated_value_by_currency": _serialize_map(quarter["value"]), "events": [_serialize_common_row(event) for event in quarter["events"]]}
            for quarter in renewal_quarters
        ]),
        "perpetual_maintenance_data": _serialize_common_row({
            "rows": [_serialize_common_row(row) for row in perpetual_rows],
            "purchase_by_currency": _serialize_map(purchase_by_currency),
            "maintenance_by_currency": _serialize_map(maintenance_totals),
            "total_by_currency": _serialize_map(total_by_currency),
            "included_count": sum(1 for row in perpetual_rows if row["maintenance_source"].startswith("included")),
            "separately_tracked_count": sum(1 for row in perpetual_rows if row["maintenance_source"] == "separately_tracked"),
        }),
        "purchase_order_data": _serialize_common_row({
            "rows": po_rows,
            "totals_by_currency": _serialize_map(po_spend),
            "line_totals_by_currency": _serialize_map({currency: sum((row["line_value"] for row in po_groups.values() if row["currency"] == currency), ZERO) for currency in {row["currency"] for row in po_groups.values()}}),
            "po_count": sum(1 for row in sorted_po_groups if row["identity_type"] != "unkeyed"),
            "unkeyed_count": sum(
                row["line_count"] for row in sorted_po_groups if row["identity_type"] == "unkeyed"
            ),
            "overridden_count": sum(1 for row in sorted_po_groups if row["override"] is not None),
        }),
    }
    return DetailedReportResponse.model_validate(response)


async def get_detailed_report(db: AsyncSession, user: User, options: ReportOptions) -> DetailedReportResponse:
    return build_report_model(await _load_licenses(db, user), options)


def build_portfolio_stats(
    licenses: list[License],
    mandatory_fields: dict,
    documents_by_license_id: dict[int, list],
    notification_days: int = 30,
) -> PortfolioStatsResponse:
    today = date.today()
    annual: dict[str, Decimal] = {}
    counts = {"active": 0, "upcoming": 0, "expiring": 0, "expired": 0}
    by_type: dict[str, int] = {license_type.value: 0 for license_type in LicenseType}
    excluded = 0
    incomplete = 0
    for license_obj in licenses:
        status = compute_expiration_status(license_obj, today, notification_days)
        if status == "perpetual":
            counts["active"] += 1
        elif status in counts:
            counts[status] += 1
        if not license_obj.is_retired:
            by_type[license_obj.license_type.value] = by_type.get(license_obj.license_type.value, 0) + 1
        completeness = compute_completeness(license_obj, documents_by_license_id.get(license_obj.id, []), mandatory_fields)
        if completeness is not None and completeness < 100 and status not in {"retired", "renewed", "pending_renewal", "legacy"}:
            incomplete += 1
        if _current_baseline_eligible(license_obj, today):
            value, _source = _annual_recurring_value(license_obj)
            if value is None:
                excluded += 1
            else:
                _add(annual, _currency(license_obj), value)
    annual_strings = _serialize_map(annual)
    return PortfolioStatsResponse(
        total_active=counts["active"] + counts["expiring"],
        total_upcoming=counts["upcoming"],
        total_expiring=counts["expiring"],
        total_expired=counts["expired"],
        total_incomplete=incomplete,
        annual_cost_by_currency={currency: float(value) for currency, value in annual.items()},
        annual_cost_by_currency_decimal=annual_strings,
        excluded_from_totals=excluded,
        by_license_type=dict(by_type),
    )

"""
Business logic for license computed fields and statistics.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import LicenseType, MaintenanceCoverage
from app.models.license_ref_seq import LicenseRefSequence
from app.services.money import MoneyParseError, parse_money

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.license import License

log = logging.getLogger(__name__)
_SUCCESSOR_START_UNKNOWN = object()


def validate_term_date_order(start_date: date | None, end_date: date | None) -> None:
    """Reject a bounded term whose end precedes its start."""
    if start_date is not None and end_date is not None and end_date < start_date:
        raise ValueError("End date cannot be before start date.")


# ---------------------------------------------------------------------------
# License reference generation
# ---------------------------------------------------------------------------


async def generate_license_ref(db: AsyncSession) -> str:
    """
    Generate the next license_ref in format LT-YYYY-NNNNN.

    Uses SELECT FOR UPDATE to lock the sequence row for the duration of the
    caller's transaction, preventing concurrent requests from reading the same
    last_value and producing duplicate refs.
    """
    result = await db.execute(select(LicenseRefSequence).where(LicenseRefSequence.id == 1).with_for_update())
    seq = result.scalar_one_or_none()
    if seq is None:
        seq = LicenseRefSequence(id=1, last_value=0)
        db.add(seq)
        await db.flush()

    seq.last_value += 1

    year = datetime.now().year
    return f"LT-{year}-{seq.last_value:05d}"


# ---------------------------------------------------------------------------
# Computed field: completeness_pct
# ---------------------------------------------------------------------------

_DOCUMENT_CATEGORIES = {
    "invoice": "invoice",
    "eula": "eula",
    "entitlement": "entitlement",
    "purchaseOrder": "purchase_order",
    "quote": "quote",
}

_FREEWARE_ALWAYS_INAPPLICABLE_FIELDS = frozenset(
    {
        "contactEmail",
        "entitlement",
        "eula",
    }
)

_FREEWARE_PURCHASE_FIELDS = frozenset(
    {
        "invoice",
        "invoiceNumber",
        "contractNumber",
        "poNumber",
        "purchaseOrder",
        "quote",
    }
)

_NON_EXPIRING_LICENSE_TYPES = frozenset(
    {
        LicenseType.perpetual,
        LicenseType.oem,
        LicenseType.freeware,
        LicenseType.service,
        LicenseType.other,
    }
)

_NON_ENTITLEMENT_LICENSE_TYPES = frozenset(
    {
        LicenseType.freeware,
        LicenseType.service,
        LicenseType.other,
    }
)

_RECURRING_LICENSE_TYPES = frozenset(
    {
        LicenseType.subscription,
        LicenseType.saas,
        LicenseType.maintenance,
    }
)

_ENTITLEMENT_DOCUMENT_FIELDS = frozenset({"entitlement", "eula"})

_DIRECT_MANDATORY_FIELDS = {
    "startDate": "start_date",
    "noticeDate": "notice_date",
    "contractNumber": "contract_number",
    "poNumber": "po_number",
    "invoiceNumber": "invoice_number",
    "contactEmail": "contact_email",
    "costCentre": "cost_centre",
    "budgetOwnerEmail": "budget_owner_email",
}


def _has_paid_included_support(license: "License") -> bool:
    if getattr(license, "maintenance_coverage", None) != MaintenanceCoverage.included:
        return False
    try:
        return (parse_money(getattr(license, "maintenance_cost", None)) or Decimal("0")) > 0
    except MoneyParseError:
        return False


def _is_applicable_mandatory_field(key: str, license: "License") -> bool:
    """Return whether a configured completeness field applies to this record."""
    if license.license_type in _NON_ENTITLEMENT_LICENSE_TYPES and key in _ENTITLEMENT_DOCUMENT_FIELDS:
        return False
    if license.license_type != LicenseType.freeware:
        return True
    if key in _FREEWARE_ALWAYS_INAPPLICABLE_FIELDS:
        return False
    if key in _FREEWARE_PURCHASE_FIELDS:
        return _has_paid_included_support(license)
    return True


# Maps mandatory_fields JSON key → how to check it on a license/docs pair
def _check_mandatory_field(
    key: str,
    license: "License",
    doc_categories: set[str],
) -> bool:
    if key in _DOCUMENT_CATEGORIES:
        return _DOCUMENT_CATEGORIES[key] in doc_categories
    if key == "endDate":
        # Non-expiring license types intentionally allow no end date.
        return license.end_date is not None or license.license_type in _NON_EXPIRING_LICENSE_TYPES
    attribute = _DIRECT_MANDATORY_FIELDS.get(key)
    if attribute is not None:
        return bool(getattr(license, attribute))
    return False


def compute_completeness(
    license: "License",
    documents: list["Document"],
    mandatory_fields: dict[str, bool],
) -> int | None:
    """Return percentage (0-100) of enabled mandatory fields that are populated.

    Returns None if the license is exempt from completeness requirements.
    """
    if license.is_completeness_exempt:
        return None

    enabled_keys = [
        key
        for key, enabled in mandatory_fields.items()
        if enabled and _is_applicable_mandatory_field(key, license)
    ]
    if not enabled_keys:
        return 100

    doc_categories = {doc.category.value for doc in documents}
    met = sum(1 for key in enabled_keys if _check_mandatory_field(key, license, doc_categories))
    return round(met * 100 / len(enabled_keys))


# ---------------------------------------------------------------------------
# Computed field: days_until_expiry
# ---------------------------------------------------------------------------


def compute_days_until_expiry(license: "License", today: date) -> int | None:
    """Days until end_date; None if no end_date."""
    if license.end_date is None:
        return None
    return (license.end_date - today).days


# ---------------------------------------------------------------------------
# Computed field: expiration_status
# ---------------------------------------------------------------------------


def compute_expiration_status(
    license: "License",
    today: date,
    notification_days: int = 30,
    *,
    successor_start_date: date | None | object = _SUCCESSOR_START_UNKNOWN,
) -> str:
    """
    Priority order:
    1. retired   - is_retired flag
    2. legacy    - lifecycle_status == "legacy"
    3. pending_renewal - lifecycle_status == "pending_renewal"
    4. upcoming  - start_date is in the future
    5. perpetual - a non-expiring license type with no end_date
    6. renewed   - own term ended and linked successor coverage has started
    7. expired   - end_date in the past
    8. expiring  - end_date within notification_days
    9. active    - everything else
    """
    if license.is_retired:
        return "retired"
    if license.lifecycle_status == "legacy":
        return "legacy"
    if license.lifecycle_status == "pending_renewal":
        return "pending_renewal"
    if license.start_date is not None and license.start_date > today:
        return "upcoming"
    if license.end_date is None:
        return "perpetual" if license.license_type in _NON_EXPIRING_LICENSE_TYPES else "active"
    if license.end_date < today:
        if license.renewed_to_id is not None:
            if successor_start_date is _SUCCESSOR_START_UNKNOWN:
                # Preserve compatibility for isolated callers that do not have
                # the successor row. Portfolio/read-model callers pass the
                # authoritative start date so a coverage gap remains Expired.
                return "renewed"
            if successor_start_date is not None and successor_start_date <= today:
                return "renewed"
        elif license.lifecycle_status == "renewed":
            # Lifecycle repair may intentionally mark a historical row without
            # reconstructing a missing chain edge.
            return "renewed"
        return "expired"
    if license.end_date <= today + timedelta(days=notification_days):
        return "expiring"
    return "active"


# ---------------------------------------------------------------------------
# Computed field: per-line total (quantity × unit price)
# ---------------------------------------------------------------------------


def calc_line_total(quantity: str | None, unit_price: str | None) -> Decimal | None:
    """
    Per-line total (quantity × unit price) from canonical stored strings.

    This is the single-license "calculated total" - NOT the whole-PO value,
    which is the sum of line totals across licenses sharing a PO number.
    Returns None when either value is blank or non-canonical.
    """
    try:
        qty = parse_money(quantity or None)
        price = parse_money(unit_price or None)
    except MoneyParseError:
        return None
    if qty is None or price is None:
        return None
    return qty * price


def calc_effective_quantity(quantity: str | None, quantity_per_unit: str | None) -> Decimal | None:
    """Return purchase quantity multiplied by entitlement quantity per unit."""
    try:
        qty = parse_money(quantity or None)
        parsed_per_unit = parse_money(quantity_per_unit or None)
    except MoneyParseError:
        return None
    if qty is None:
        return None
    per_unit = parsed_per_unit if parsed_per_unit is not None else Decimal("1")
    return qty * per_unit


def _inclusive_term_days(start_date: date | None, end_date: date | None) -> int | None:
    if start_date is None or end_date is None or end_date < start_date:
        return None
    return (end_date - start_date).days + 1


def annualize_term_cost(amount: Decimal, start_date: date | None, end_date: date | None) -> Decimal:
    """Return normalized yearly cost for a term total using actual calendar days."""
    term_days = _inclusive_term_days(start_date, end_date)
    if term_days is None or term_days <= 365:
        return amount
    return amount * Decimal("365") / Decimal(term_days)


def calc_recurring_annual_cost(license_obj: "License") -> Decimal | None:
    """Return annualized recurring line cost, or None when stored money is invalid."""
    try:
        qty = parse_money(str(license_obj.quantity) if license_obj.quantity else None) or Decimal("0")
        price = parse_money(str(license_obj.unit_price) if license_obj.unit_price else None) or Decimal("0")
    except MoneyParseError:
        return None
    return annualize_term_cost(qty * price, license_obj.start_date, license_obj.end_date)


# ---------------------------------------------------------------------------
# Dashboard statistics
# ---------------------------------------------------------------------------


def compute_stats(
    licenses: list["License"],
    documents_by_license_id: dict[int, list["Document"]],
    mandatory_fields: dict[str, bool],
    notification_days: int = 30,
) -> dict:
    today = date.today()

    total = len(licenses)
    total_incomplete = 0
    status_counts: Counter[str] = Counter()
    annual_cost_by_currency: dict[str, Decimal] = {}
    excluded_from_totals = 0
    licenses_by_id = {lic.id: lic for lic in licenses}

    for lic in licenses:
        docs = documents_by_license_id.get(lic.id, [])
        successor = licenses_by_id.get(lic.renewed_to_id) or lic.__dict__.get("renewed_to")
        status = compute_expiration_status(
            lic,
            today,
            notification_days,
            successor_start_date=successor.start_date if successor is not None else None,
        )
        completeness = compute_completeness(lic, docs, mandatory_fields)

        status_counts[status] += 1

        # Incomplete: completeness < 100, not retired/renewed/pending/legacy, not exempt
        if (
            completeness is not None
            and completeness < 100
            and status not in ("retired", "renewed", "pending_renewal", "legacy")
        ):
            total_incomplete += 1

        # Annual cost: includes active recurring-revenue license types, grouped by currency.
        # Perpetual and OEM are one-time capex -- their unit_price x quantity
        # is excluded from the annual rollup. When they have attached
        # maintenance, that maintenance is a separate License record
        # (license_type="maintenance") which contributes on its own below.
        # Freeware contributes zero.
        if status in ("active", "perpetual", "expiring"):
            if lic.license_type in _RECURRING_LICENSE_TYPES:
                annual_cost = calc_recurring_annual_cost(lic)
                if annual_cost is not None:
                    cur = lic.currency or "USD"
                    annual_cost_by_currency[cur] = annual_cost_by_currency.get(cur, Decimal("0")) + annual_cost
                else:
                    log.warning(
                        "annual_cost: skipping license id=%s - non-canonical quantity=%r unit_price=%r",
                        lic.id,
                        lic.quantity,
                        lic.unit_price,
                    )
                    excluded_from_totals += 1
            elif (
                lic.license_type in (LicenseType.freeware, LicenseType.perpetual, LicenseType.oem)
                and _has_paid_included_support(lic)
                and (
                    getattr(lic, "maintenance_start_date", None) is None
                    or lic.maintenance_start_date <= today
                )
                and (
                    getattr(lic, "maintenance_end_date", None) is None
                    or lic.maintenance_end_date >= today
                )
            ):
                try:
                    support_cost = parse_money(getattr(lic, "maintenance_cost", None)) or Decimal("0")
                    support_cost = annualize_term_cost(
                        support_cost,
                        getattr(lic, "maintenance_start_date", None),
                        getattr(lic, "maintenance_end_date", None),
                    )
                    cur = lic.currency or "USD"
                    annual_cost_by_currency[cur] = annual_cost_by_currency.get(cur, Decimal("0")) + support_cost
                except MoneyParseError:
                    excluded_from_totals += 1
            # Perpetual and OEM base purchase cost contributes zero here.

    return {
        "total": total,
        "total_active": status_counts["active"] + status_counts["perpetual"] + status_counts["expiring"],
        "total_expiring": status_counts["expiring"],
        "total_expired": status_counts["expired"],
        "total_upcoming": status_counts["upcoming"],
        "total_pending": status_counts["pending_renewal"],
        "total_incomplete": total_incomplete,
        "total_retired": status_counts["retired"],
        "total_renewed": status_counts["renewed"],
        "total_legacy": status_counts["legacy"],
        "annual_cost_by_currency": {k: float(v) for k, v in annual_cost_by_currency.items()},
        "excluded_from_totals": excluded_from_totals,
    }

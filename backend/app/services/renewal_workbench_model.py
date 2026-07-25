"""
Renewal workbench computation - pure functions with no database access.

All functions here are synchronous and side-effect-free. They can be
imported and unit-tested without standing up a database session.
"""

from __future__ import annotations

from decimal import Decimal

from app.models.license import License, LicenseType
from app.schemas.renewal import RenewalRiskFlag, RenewalStatus, RenewalWorkbenchRow
from app.services.money import MoneyParseError, parse_money


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HIGH_VALUE_THRESHOLD = Decimal("50000")

ALLOWED_WORKBENCH_VIEWS = {
    "all",
    "needs_action",
    "overdue",
    "due_30",
    "due_60",
    "due_90",
    "in_progress",
    "missing_docs",
    "high_value",
}

RECURRING_LICENSE_TYPES = {
    LicenseType.subscription,
    LicenseType.saas,
    LicenseType.maintenance,
}


# ---------------------------------------------------------------------------
# Public computation functions
# ---------------------------------------------------------------------------


def estimate_annual_value(license_obj: License) -> Decimal | None:
    """Return the recurring annual estimate, or None for invalid numeric data."""
    if license_obj.license_type not in RECURRING_LICENSE_TYPES:
        return Decimal("0")
    try:
        quantity = parse_money(str(license_obj.quantity) if license_obj.quantity is not None else None)
        unit_price = parse_money(str(license_obj.unit_price) if license_obj.unit_price is not None else None)
    except MoneyParseError:
        return None
    return (quantity or Decimal("0")) * (unit_price or Decimal("0"))


def compute_risk_flags(
    license_obj: License,
    renewal_status: RenewalStatus,
    days_until_expiry: int | None,
    completeness_pct: int | None,
    document_count: int,
    estimated_annual_value: Decimal | None,
    window_days: int,
    high_value_threshold: Decimal | None = None,
) -> list[RenewalRiskFlag]:
    """Compute the list of risk flags for a single renewal workbench row."""
    threshold = high_value_threshold if high_value_threshold is not None else HIGH_VALUE_THRESHOLD
    flags: list[RenewalRiskFlag] = []

    if days_until_expiry is not None and days_until_expiry < 0:
        flags.append(_flag("expired", "Expired", "high"))
    elif days_until_expiry is not None and days_until_expiry <= 30:
        flags.append(_flag("due_30", "Due within 30 days", "high"))
    elif days_until_expiry is not None and days_until_expiry <= 60:
        flags.append(_flag("due_60", "Due within 60 days", "medium"))
    elif days_until_expiry is not None and days_until_expiry <= 90:
        flags.append(_flag("due_90", "Due within 90 days", "low"))

    if not _has_value(license_obj.supplier):
        flags.append(_flag("no_supplier", "No supplier", "medium"))
    if not _has_value(license_obj.contract_number):
        flags.append(_flag("no_contract", "No contract", "medium"))
    if not _has_value(license_obj.po_number):
        flags.append(_flag("no_po", "No PO", "low"))
    if document_count == 0:
        flags.append(_flag("no_documents", "No documents", "medium"))
    if completeness_pct is not None and completeness_pct < 100:
        flags.append(_flag("incomplete", "Incomplete mandatory fields", "medium"))
    if estimated_annual_value is None:
        flags.append(_flag("invalid_numeric", "Invalid quantity or unit price", "medium"))
    elif estimated_annual_value >= threshold:
        flags.append(_flag("high_value", "High value", "high"))
    if renewal_status in ("expired_unresolved", "due_soon"):
        flags.append(
            _flag(
                "renewal_not_started",
                "Renewal not started",
                "high" if renewal_status == "expired_unresolved" else "medium",
            )
        )
    if renewal_status == "pending_order":
        flags.append(_flag("pending_order", "Pending order", "low"))
    return flags


def matches_workbench_view(
    row: RenewalWorkbenchRow,
    view: str,
) -> bool:
    """Return True if the workbench row should be included in the given view."""
    if view == "all":
        return True
    if view == "needs_action":
        return row.renewal_status in ("expired_unresolved", "due_soon")
    if view == "overdue":
        return row.renewal_status == "expired_unresolved"
    if view == "due_30":
        return row.days_until_expiry is not None and 0 <= row.days_until_expiry <= 30
    if view == "due_60":
        return row.days_until_expiry is not None and 0 <= row.days_until_expiry <= 60
    if view == "due_90":
        return row.days_until_expiry is not None and 0 <= row.days_until_expiry <= 90
    if view == "in_progress":
        return row.renewal_status in ("pending_renewal", "in_sourcing", "pending_order")
    if view == "missing_docs":
        return row.document_count == 0
    if view == "high_value":
        return any(flag.code == "high_value" for flag in row.risk_flags)
    return True


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _flag(code: str, label: str, severity: str) -> RenewalRiskFlag:
    return RenewalRiskFlag(code=code, label=label, severity=severity)


def _has_value(value: str | None) -> bool:
    return bool(value and value.strip())

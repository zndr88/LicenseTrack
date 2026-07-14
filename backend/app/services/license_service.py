"""
Business logic for license computed fields and statistics.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import LicenseType
from app.models.license_ref_seq import LicenseRefSequence
from app.services.money import MoneyParseError, parse_money

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.license import License

log = logging.getLogger(__name__)


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


# Maps mandatory_fields JSON key → how to check it on a license/docs pair
def _check_mandatory_field(
    key: str,
    license: "License",
    doc_categories: set[str],
) -> bool:
    if key in _DOCUMENT_CATEGORIES:
        return _DOCUMENT_CATEGORIES[key] in doc_categories
    if key == "startDate":
        return license.start_date is not None
    if key == "endDate":
        # Perpetual licenses intentionally have no end date - satisfy the requirement
        return license.end_date is not None or license.license_type in (
            LicenseType.perpetual,
            LicenseType.oem,
            LicenseType.freeware,
        )
    if key == "contractNumber":
        return bool(license.contract_number)
    if key == "poNumber":
        return bool(license.po_number)
    if key == "invoiceNumber":
        return bool(license.invoice_number)
    if key == "contactEmail":
        return bool(license.contact_email)
    if key == "costCentre":
        return bool(license.cost_centre)
    if key == "budgetOwnerEmail":
        return bool(license.budget_owner_email)
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

    enabled_keys = [key for key, enabled in mandatory_fields.items() if enabled]
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
) -> str:
    """
    Priority order:
    1. retired   - is_retired flag
    2. legacy    - lifecycle_status == "legacy"
    3. renewed   - lifecycle_status == "renewed"
    4. pending_renewal - lifecycle_status == "pending_renewal"
    5. perpetual - no end_date
    6. expired   - end_date in the past
    7. expiring  - end_date within notification_days
    8. active    - everything else
    """
    if license.is_retired:
        return "retired"
    if license.lifecycle_status == "legacy":
        return "legacy"
    if license.lifecycle_status == "renewed":
        return "renewed"
    if license.lifecycle_status == "pending_renewal":
        return "pending_renewal"
    if license.end_date is None:
        return "perpetual"
    if license.end_date < today:
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
    total_active = 0
    total_expiring = 0
    total_expired = 0
    total_pending = 0
    total_incomplete = 0
    total_retired = 0
    total_renewed = 0
    total_legacy = 0
    annual_cost_by_currency: dict[str, Decimal] = {}
    excluded_from_totals = 0

    for lic in licenses:
        docs = documents_by_license_id.get(lic.id, [])
        status = compute_expiration_status(lic, today, notification_days)
        completeness = compute_completeness(lic, docs, mandatory_fields)

        if status == "retired":
            total_retired += 1
        elif status == "legacy":
            total_legacy += 1
        elif status == "renewed":
            total_renewed += 1
        elif status == "pending_renewal":
            total_pending += 1
        elif status == "expired":
            total_expired += 1
        elif status == "expiring":
            total_expiring += 1
            total_active += 1
        elif status in ("active", "perpetual"):
            total_active += 1

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
        if status in ("active", "perpetual", "expiring") and lic.renewed_to_id is None:
            if lic.license_type in (
                LicenseType.subscription,
                LicenseType.saas,
                LicenseType.maintenance,
            ):
                try:
                    qty = parse_money(str(lic.quantity) if lic.quantity else None) or Decimal("0")
                    price = parse_money(str(lic.unit_price) if lic.unit_price else None) or Decimal("0")
                    cur = lic.currency or "USD"
                    annual_cost_by_currency[cur] = annual_cost_by_currency.get(cur, Decimal("0")) + qty * price
                except MoneyParseError:
                    log.warning(
                        "annual_cost: skipping license id=%s - non-canonical quantity=%r unit_price=%r",
                        lic.id,
                        lic.quantity,
                        lic.unit_price,
                    )
                    excluded_from_totals += 1
            # Perpetual, OEM, Freeware contribute zero

    return {
        "total": total,
        "total_active": total_active,
        "total_expiring": total_expiring,
        "total_expired": total_expired,
        "total_pending": total_pending,
        "total_incomplete": total_incomplete,
        "total_retired": total_retired,
        "total_renewed": total_renewed,
        "total_legacy": total_legacy,
        "annual_cost_by_currency": {k: float(v) for k, v in annual_cost_by_currency.items()},
        "excluded_from_totals": excluded_from_totals,
    }

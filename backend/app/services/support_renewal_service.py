"""Start a support renewal for included support through procurement."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseMetric, LicenseType, MaintenanceCoverage
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User
from app.services.audit_service import log_event
from app.services.license_service import INCLUDED_SUPPORT_PARENT_TYPES
from app.services.money import MoneyParseError, parse_money
from app.services.sourcing_service import ensure_sourcing_request_for_item


@dataclass
class SupportRenewalResult:
    license: License
    sourcing_item: SourcingItem


def open_support_renewal_filter(parent_license_id):
    """SQL filter for a support-renewal line that has not become a license yet."""
    converted = exists().where(License.source_sourcing_item_id == SourcingItem.id)
    return (
        SourcingItem.maintenance_parent_license_id == parent_license_id,
        SourcingItem.status != SourcingStatus.cancelled,
        ~converted,
    )


def _next_support_term(previous_end: date) -> tuple[date, date]:
    start = previous_end + timedelta(days=1)
    try:
        next_anniversary = start.replace(year=start.year + 1)
    except ValueError:  # 29 February
        next_anniversary = start.replace(year=start.year + 1, day=28) + timedelta(days=1)
    return start, next_anniversary - timedelta(days=1)


def _previous_cost(parent: License) -> str | None:
    try:
        cost = parse_money(parent.maintenance_cost)
    except MoneyParseError:
        return None
    return format(cost, "f") if cost is not None and cost > Decimal("0") else None


async def start_support_renewal(
    *,
    db: AsyncSession,
    license_id: int,
    actor: User,
    ip_address: str | None,
) -> SupportRenewalResult:
    """Create a sourcing request with one maintenance line for a license's included support.

    The line carries its parent license, so conversion links the new support
    record automatically. Coverage stays Included until that record exists;
    activating it snapshots the included period into coverage history.
    """
    parent = await db.get(License, license_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="License not found")
    if parent.license_type not in INCLUDED_SUPPORT_PARENT_TYPES:
        raise HTTPException(status_code=400, detail="Support renewal applies to perpetual, OEM and freeware licenses")
    if parent.maintenance_coverage != MaintenanceCoverage.included or parent.maintenance_end_date is None:
        raise HTTPException(status_code=400, detail="This license has no included support period with an end date")
    if parent.is_retired or parent.lifecycle_status == "legacy":
        raise HTTPException(status_code=409, detail="Retired or legacy licenses cannot start a support renewal")
    existing = await db.scalar(select(SourcingItem.id).where(*open_support_renewal_filter(parent.id)).limit(1))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A support renewal is already in progress for this license")

    start_date, end_date = _next_support_term(parent.maintenance_end_date)
    previous_cost = _previous_cost(parent)
    item = SourcingItem(
        publisher_name=parent.publisher_name,
        publisher_id=parent.publisher_id,
        software_description=f"{parent.software_description} Maintenance",
        license_type=LicenseType.maintenance,
        license_metric=parent.license_metric or LicenseMetric.per_user,
        maintenance_coverage=MaintenanceCoverage.not_applicable,
        quantity=parent.quantity or None,
        quantity_per_unit=parent.quantity_per_unit or "1",
        estimated_unit_price=None,
        estimated_total_price=previous_cost,
        currency=parent.currency,
        supplier=parent.supplier or None,
        supplier_id=parent.supplier_id,
        contact_email=parent.contact_email or None,
        cost_centre=parent.cost_centre or None,
        budget_owner_email=parent.budget_owner_email or None,
        secondary_contacts=list(parent.secondary_contacts or []),
        start_date=start_date,
        end_date=end_date,
        notes=f"Support renewal for {parent.license_ref or parent.software_description}.",
        status=SourcingStatus.sourcing,
        maintenance_parent_license_id=parent.id,
        created_by=actor.id,
    )
    db.add(item)
    await db.flush()
    await ensure_sourcing_request_for_item(db, item, created_by=actor.id)
    await log_event(
        db,
        "license.support_renewal_started",
        actor=actor,
        ip_address=ip_address,
        target_type="license",
        target_id=str(parent.id),
        target_label=parent.software_description,
        detail=f"support renewal sourcing item {item.id} created",
    )
    return SupportRenewalResult(license=parent, sourcing_item=item)

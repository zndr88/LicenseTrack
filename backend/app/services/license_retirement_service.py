"""Scheduled license retirement workflow."""

from __future__ import annotations

from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.services.audit_service import log_event
from app.services.license_service import RENEWAL_OPT_IN_LICENSE_TYPES
from app.services.maintenance_service import retire_maintenance_license


def normalize_retirement_update(
    license_obj: License | None,
    update_data: dict,
    *,
    today: date | None = None,
) -> None:
    """Translate a retirement request into immediate or end-of-term state."""
    today = today or date.today()
    existing_end_date = license_obj.end_date if license_obj is not None else None
    end_date = update_data.get("end_date", existing_end_date)
    retirement_requested = update_data.get("is_retired")
    has_retirement_request = "is_retired" in update_data
    was_scheduled = bool(getattr(license_obj, "retirement_scheduled", False))

    if has_retirement_request:
        if retirement_requested and end_date is not None and end_date >= today:
            update_data["is_retired"] = False
            update_data["retirement_scheduled"] = True
        else:
            update_data["is_retired"] = bool(retirement_requested)
            update_data["retirement_scheduled"] = False
        return

    if was_scheduled and "end_date" in update_data:
        retirement_is_due = end_date is None or end_date < today
        update_data["is_retired"] = retirement_is_due
        update_data["retirement_scheduled"] = not retirement_is_due


async def retire_due_licenses(db: AsyncSession, *, today: date | None = None) -> int:
    """Materialize scheduled retirements and retire ended one-off Service/Other records."""
    today = today or date.today()
    result = await db.execute(
        select(License).where(
            License.retirement_scheduled.is_(True),
            License.end_date.isnot(None),
            License.end_date < today,
        )
    )
    due_licenses = list(result.scalars().all())

    for license_obj in due_licenses:
        if license_obj.license_type == LicenseType.maintenance:
            await retire_maintenance_license(db, license_obj)
        else:
            license_obj.is_retired = True
        license_obj.retirement_scheduled = False
        await log_event(
            db,
            "license.updated",
            target_type="license",
            target_id=str(license_obj.id),
            target_label=license_obj.software_description,
            detail=(
                "is_retired: False → True\n"
                "retirement_scheduled: True → False\n"
                "reason: scheduled retirement reached term end"
            ),
        )

    one_off_licenses = await _ended_one_off_licenses(db, today)
    for license_obj in one_off_licenses:
        license_obj.is_retired = True
        await log_event(
            db,
            "license.updated",
            target_type="license",
            target_id=str(license_obj.id),
            target_label=license_obj.software_description,
            detail="is_retired: False → True\nreason: one-off service ended",
        )

    if due_licenses or one_off_licenses:
        await db.commit()
    return len(due_licenses) + len(one_off_licenses)


async def _ended_one_off_licenses(db: AsyncSession, today: date) -> list[License]:
    """Service/Other records not marked renewable whose end date has passed."""
    result = await db.execute(
        select(License).where(
            License.license_type.in_(RENEWAL_OPT_IN_LICENSE_TYPES),
            or_(License.is_renewable.is_(None), License.is_renewable.is_(False)),
            License.is_retired.is_(False),
            License.retirement_scheduled.is_(False),
            License.end_date.isnot(None),
            License.end_date < today,
            or_(License.lifecycle_status.is_(None), License.lifecycle_status != "legacy"),
        )
    )
    return list(result.scalars().all())

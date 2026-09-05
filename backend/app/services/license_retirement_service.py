"""Scheduled license retirement workflow."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.services.audit_service import log_event
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
    """Materialize scheduled retirements whose licensed term has ended."""
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

    if due_licenses:
        await db.commit()
    return len(due_licenses)

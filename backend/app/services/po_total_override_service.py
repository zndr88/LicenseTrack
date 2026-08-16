from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License


async def get_po_total_override(
    db: AsyncSession,
    po_number: str | None,
    *,
    exclude_license_id: int | None = None,
) -> str | None:
    """Return the shared override currently assigned to a PO, if any."""
    if not po_number:
        return None

    statement = (
        select(License.po_total_override)
        .where(
            License.po_number == po_number,
            License.po_total_override.is_not(None),
        )
        .order_by(License.id)
    )
    if exclude_license_id is not None:
        statement = statement.where(License.id != exclude_license_id)

    # Override inheritance is a read-only lookup. Avoid flushing unrelated
    # pending ORM work when this helper runs inside a larger conversion.
    with db.no_autoflush:
        result = await db.execute(statement)
    return result.scalars().first()


async def inherit_po_total_override(db: AsyncSession, data: dict) -> None:
    """Apply an existing PO group's override to a new license payload."""
    if "po_total_override" in data:
        return
    data["po_total_override"] = await get_po_total_override(db, data.get("po_number"))


async def resolve_reassigned_po_total_override(
    db: AsyncSession,
    license_obj: License,
    new_po_number: str | None,
) -> str | None:
    """Resolve the override when an existing license changes PO membership."""
    old_po_number = license_obj.po_number
    if new_po_number == old_po_number:
        return license_obj.po_total_override
    if not new_po_number:
        return None

    new_group_result = await db.execute(
        select(License.id).where(
            License.po_number == new_po_number,
            License.id != license_obj.id,
        )
    )
    new_group_exists = new_group_result.scalars().first() is not None
    if new_group_exists:
        return await get_po_total_override(
            db,
            new_po_number,
            exclude_license_id=license_obj.id,
        )

    if not old_po_number:
        return None

    old_group_result = await db.execute(
        select(License.id).where(
            License.po_number == old_po_number,
            License.id != license_obj.id,
        )
    )
    old_group_has_siblings = old_group_result.scalars().first() is not None
    return None if old_group_has_siblings else license_obj.po_total_override


async def apply_po_total_override(
    db: AsyncSession,
    license_id: int,
    value: str | None,
) -> tuple[License, int]:
    """Set or clear the shared PO total override for every license in a PO."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if not license_obj.po_number:
        raise HTTPException(status_code=400, detail="A PO number is required to override the total PO value")

    result = await db.execute(select(License).where(License.po_number == license_obj.po_number))
    matching_licenses = list(result.scalars().all())
    for matching_license in matching_licenses:
        matching_license.po_total_override = value
    return license_obj, len(matching_licenses)

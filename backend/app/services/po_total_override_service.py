from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License


async def get_po_total_override(
    db: AsyncSession,
    po_number: str | None,
    currency: str | None,
    *,
    exclude_license_id: int | None = None,
) -> str | None:
    """Return the shared override assigned to a PO and currency, if any."""
    if not po_number or not currency:
        return None

    statement = (
        select(License.po_total_override)
        .where(
            License.po_number == po_number,
            License.currency == currency,
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
    """Apply an existing PO/currency group's override to a new license payload."""
    if "po_total_override" in data:
        return
    data["po_total_override"] = await get_po_total_override(
        db,
        data.get("po_number"),
        data.get("currency"),
    )


async def resolve_reassigned_po_total_override(
    db: AsyncSession,
    license_obj: License,
    new_po_number: str | None,
    new_currency: str | None = None,
) -> str | None:
    """Resolve the override when a license changes PO/currency membership."""
    old_po_number = license_obj.po_number
    old_currency = license_obj.currency
    target_currency = new_currency or old_currency
    if new_po_number == old_po_number and target_currency == old_currency:
        return license_obj.po_total_override
    if not new_po_number or not target_currency:
        return None

    new_group_result = await db.execute(
        select(License.id).where(
            License.po_number == new_po_number,
            License.currency == target_currency,
            License.id != license_obj.id,
        )
    )
    new_group_exists = new_group_result.scalars().first() is not None
    if new_group_exists:
        return await get_po_total_override(
            db,
            new_po_number,
            target_currency,
            exclude_license_id=license_obj.id,
        )

    if not old_po_number:
        return None

    old_group_result = await db.execute(
        select(License.id).where(
            License.po_number == old_po_number,
            License.currency == old_currency,
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
    """Set or clear the shared override for every license in a PO/currency group."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if not license_obj.po_number:
        raise HTTPException(status_code=400, detail="A PO number is required to override the total PO value")

    result = await db.execute(
        select(License).where(
            License.po_number == license_obj.po_number,
            License.currency == license_obj.currency,
        )
    )
    matching_licenses = list(result.scalars().all())
    for matching_license in matching_licenses:
        matching_license.po_total_override = value
    return license_obj, len(matching_licenses)

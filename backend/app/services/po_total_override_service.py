from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License


def procurement_identity_key(
    *,
    license_id: int | None = None,
    pending_order_id: int | None = None,
    procurement_bundle_id: str | None = None,
    po_number: str | None = None,
    currency: str | None = None,
) -> tuple[str, str] | None:
    """Return the durable procurement identity and currency for a license."""
    normalized_currency = (currency or "").strip().upper()
    if not normalized_currency:
        return None
    if pending_order_id is not None:
        return (f"pending-order:{pending_order_id}", normalized_currency)
    if procurement_bundle_id:
        return (f"procurement-bundle:{procurement_bundle_id}", normalized_currency)
    normalized_po = " ".join((po_number or "").split()).casefold()
    if normalized_po:
        return (f"po:{normalized_po}", normalized_currency)
    if license_id is not None:
        return (f"unkeyed:{license_id}", normalized_currency)
    return None


def _identity_filter(
    *,
    pending_order_id: int | None,
    procurement_bundle_id: str | None,
    po_number: str | None,
    currency: str | None,
    license_id: int | None = None,
):
    identity = procurement_identity_key(
        license_id=license_id,
        pending_order_id=pending_order_id,
        procurement_bundle_id=procurement_bundle_id,
        po_number=po_number,
        currency=currency,
    )
    if identity is None:
        return None
    identity_value, normalized_currency = identity
    currency_filter = func.upper(func.trim(License.currency)) == normalized_currency
    if identity_value.startswith("pending-order:"):
        return (License.pending_order_id == pending_order_id, currency_filter)
    if identity_value.startswith("procurement-bundle:"):
        return (License.procurement_bundle_id == procurement_bundle_id, currency_filter)
    if identity_value.startswith("po:"):
        return (func.lower(func.trim(License.po_number)) == identity_value[3:], currency_filter)
    return (License.id == license_id, currency_filter)


async def get_po_total_override(
    db: AsyncSession,
    po_number: str | None,
    currency: str | None,
    *,
    exclude_license_id: int | None = None,
    pending_order_id: int | None = None,
    procurement_bundle_id: str | None = None,
) -> str | None:
    """Return the shared override assigned to a durable procurement identity."""
    filters = _identity_filter(
        pending_order_id=pending_order_id,
        procurement_bundle_id=procurement_bundle_id,
        po_number=po_number,
        currency=currency,
    )
    if filters is None:
        return None

    statement = (
        select(License.po_total_override)
        .where(*filters, License.po_total_override.is_not(None))
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
        pending_order_id=data.get("pending_order_id"),
        procurement_bundle_id=data.get("procurement_bundle_id"),
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

    if license_obj.pending_order_id is not None or license_obj.procurement_bundle_id:
        # A PO-number correction does not change the durable procurement event.
        # Currency remains part of the financial identity, however, so an
        # override must never be carried into a different native currency.
        if target_currency == old_currency:
            return license_obj.po_total_override
        return await get_po_total_override(
            db,
            new_po_number,
            target_currency,
            exclude_license_id=license_obj.id,
            pending_order_id=license_obj.pending_order_id,
            procurement_bundle_id=license_obj.procurement_bundle_id,
        )

    target_filters = _identity_filter(
        pending_order_id=None,
        procurement_bundle_id=None,
        po_number=new_po_number,
        currency=target_currency,
        license_id=license_obj.id,
    )
    old_filters = _identity_filter(
        pending_order_id=None,
        procurement_bundle_id=None,
        po_number=old_po_number,
        currency=old_currency,
        license_id=license_obj.id,
    )
    if target_filters is None or old_filters is None:
        return None

    new_group_result = await db.execute(
        select(License.id).where(
            *target_filters,
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
            *old_filters,
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

    filters = _identity_filter(
        pending_order_id=license_obj.pending_order_id,
        procurement_bundle_id=license_obj.procurement_bundle_id,
        po_number=license_obj.po_number,
        currency=license_obj.currency,
        license_id=license_obj.id,
    )
    result = await db.execute(select(License).where(*filters))
    matching_licenses = list(result.scalars().all())
    for matching_license in matching_licenses:
        matching_license.po_total_override = value
    return license_obj, len(matching_licenses)

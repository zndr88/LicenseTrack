"""Lifecycle and renewal-chain invariants for license mutations."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License

REPAIR_ONLY_UPDATE_FIELDS = {
    "renewed_from_id",
    "renewed_to_id",
    "predecessor_id",
    "coterm_from_ids",
}

LIFECYCLE_REPAIR_FIELDS = {
    "lifecycle_status",
    *REPAIR_ONLY_UPDATE_FIELDS,
}


def _value(value):
    return getattr(value, "value", value)


def validate_general_license_update_fields(update_data: dict, license_obj: License) -> None:
    """Reject lifecycle-chain changes through ordinary license update routes."""
    repair_fields = sorted(
        field
        for field in REPAIR_ONLY_UPDATE_FIELDS
        if field in update_data and update_data[field] != getattr(license_obj, field)
    )
    if repair_fields:
        raise HTTPException(
            status_code=400,
            detail=(
                "Lifecycle and relationship repair fields cannot be changed through "
                f"the general license update endpoint: {', '.join(repair_fields)}"
            ),
        )

    if "lifecycle_status" in update_data:
        status_value = _value(update_data.get("lifecycle_status"))
        current_value = _value(license_obj.lifecycle_status)
        if status_value != current_value and status_value not in (None, "legacy"):
            raise HTTPException(
                status_code=400,
                detail="Only the legacy lifecycle flag can be changed through general license update.",
            )


def assert_can_initiate_renewal(license_obj: License) -> None:
    if license_obj.lifecycle_status == "pending_renewal":
        raise HTTPException(status_code=409, detail="Renewal already initiated for this license")
    if license_obj.lifecycle_status == "renewed":
        raise HTTPException(status_code=409, detail="License has already been renewed")
    assert_predecessor_has_no_successor(license_obj)
    if license_obj.end_date is None:
        raise HTTPException(status_code=400, detail="Cannot initiate renewal on a perpetual license (no end date)")


def assert_can_cancel_renewal(license_obj: License) -> None:
    if license_obj.lifecycle_status != "pending_renewal":
        raise HTTPException(status_code=400, detail="License is not in pending_renewal status")


def mark_pending_renewal(license_obj: License) -> None:
    assert_can_initiate_renewal(license_obj)
    license_obj.lifecycle_status = "pending_renewal"


def clear_pending_renewal(license_obj: License) -> None:
    assert_can_cancel_renewal(license_obj)
    license_obj.lifecycle_status = None
    license_obj.renewed_from_id = None


def clear_pending_renewal_if_current(license_obj: License) -> None:
    if license_obj.lifecycle_status == "pending_renewal":
        license_obj.lifecycle_status = None


def assert_predecessor_has_no_successor(
    predecessor: License,
    *,
    allowed_successor_id: int | None = None,
    status_code: int = 409,
) -> None:
    if predecessor.renewed_to_id not in (None, allowed_successor_id):
        raise HTTPException(
            status_code=status_code,
            detail=f"License {predecessor.id} has already been renewed",
        )


def mark_predecessor_renewed(predecessor: License, successor_id: int) -> None:
    assert_predecessor_has_no_successor(predecessor)
    predecessor.lifecycle_status = "renewed"
    predecessor.renewed_to_id = successor_id


async def validate_lifecycle_repair_update(
    db: AsyncSession,
    license_obj: License,
    update_data: dict,
) -> None:
    """Validate an admin lifecycle repair before fields are applied."""
    unknown_fields = sorted(set(update_data) - LIFECYCLE_REPAIR_FIELDS)
    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported repair field(s): {', '.join(unknown_fields)}",
        )
    if not update_data:
        raise HTTPException(status_code=422, detail="At least one repair field is required")

    proposed = {
        "renewed_from_id": update_data.get("renewed_from_id", license_obj.renewed_from_id),
        "renewed_to_id": update_data.get("renewed_to_id", license_obj.renewed_to_id),
        "predecessor_id": update_data.get("predecessor_id", license_obj.predecessor_id),
        "coterm_from_ids": update_data.get("coterm_from_ids", license_obj.coterm_from_ids),
    }

    if proposed["renewed_from_id"] is not None and proposed["renewed_to_id"] is not None:
        raise HTTPException(
            status_code=400,
            detail="A license cannot have both renewed_from_id and renewed_to_id set simultaneously.",
        )

    await _validate_repair_targets(db, license_obj, proposed)
    await _validate_reciprocal_chain_links(db, license_obj, proposed)


async def _validate_repair_targets(db: AsyncSession, license_obj: License, proposed: dict) -> None:
    target_fields = ("renewed_from_id", "renewed_to_id", "predecessor_id")
    target_ids = {
        proposed[field]
        for field in target_fields
        if proposed[field] is not None
    }
    coterm_ids = proposed.get("coterm_from_ids") or []
    target_ids.update(coterm_ids)

    if license_obj.id in target_ids:
        raise HTTPException(status_code=400, detail="Lifecycle repair cannot link a license to itself.")

    if len(coterm_ids) != len(set(coterm_ids)):
        raise HTTPException(status_code=400, detail="coterm_from_ids cannot contain duplicate license IDs.")

    if not target_ids:
        return

    result = await db.execute(select(License.id).where(License.id.in_(target_ids)))
    found_ids = set(result.scalars().all())
    missing_ids = sorted(target_ids - found_ids)
    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Lifecycle repair target license(s) not found: {missing_ids}",
        )


async def _validate_reciprocal_chain_links(db: AsyncSession, license_obj: License, proposed: dict) -> None:
    renewed_from_id = proposed.get("renewed_from_id")
    renewed_to_id = proposed.get("renewed_to_id")

    if renewed_from_id is not None:
        predecessor = await db.get(License, renewed_from_id)
        if predecessor is not None:
            assert_predecessor_has_no_successor(
                predecessor,
                allowed_successor_id=license_obj.id,
                status_code=400,
            )
        await _assert_no_successor_cycle(db, start_id=renewed_from_id, blocked_id=license_obj.id)

    if renewed_to_id is not None:
        successor = await db.get(License, renewed_to_id)
        if successor is not None and successor.renewed_from_id not in (None, license_obj.id):
            raise HTTPException(
                status_code=400,
                detail="renewed_to_id target already points to a different predecessor.",
            )
        await _assert_no_successor_cycle(db, start_id=renewed_to_id, blocked_id=license_obj.id)


async def _assert_no_successor_cycle(db: AsyncSession, *, start_id: int, blocked_id: int) -> None:
    seen: set[int] = set()
    current_id: int | None = start_id
    while current_id is not None:
        if current_id == blocked_id:
            raise HTTPException(status_code=400, detail="Lifecycle repair would create a renewal-chain cycle.")
        if current_id in seen:
            raise HTTPException(status_code=400, detail="Existing renewal-chain cycle detected.")
        seen.add(current_id)
        current = await db.get(License, current_id)
        current_id = current.renewed_to_id if current is not None else None


def validate_renewal_link_invariants(license_obj: License) -> None:
    if license_obj.renewed_from_id is not None and license_obj.renewed_to_id is not None:
        raise HTTPException(
            status_code=400,
            detail="A license cannot have both renewed_from_id and renewed_to_id set simultaneously.",
        )

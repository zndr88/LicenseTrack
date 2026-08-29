"""Lifecycle and renewal-chain invariants for license mutations.

An intermediate license may have both an incoming and an outgoing link.
Each predecessor has at most one successor; coterm successors may have
multiple predecessors recorded in ``coterm_from_ids``.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType

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

NON_RENEWABLE_LICENSE_TYPES = frozenset({LicenseType.service, LicenseType.other})


def normalize_entitlement_identity(value: object) -> str:
    """Normalize a human-entered entitlement field for identity comparisons."""
    return " ".join(str(value or "").strip().casefold().split())


def entitlement_identity(license_obj: License) -> tuple[str, str, str, str, str]:
    """Return the stable identity used when matching renewal entitlements."""
    return (
        normalize_entitlement_identity(license_obj.publisher_name),
        normalize_entitlement_identity(license_obj.software_description),
        normalize_entitlement_identity(license_obj.sku_code),
        normalize_entitlement_identity(license_obj.license_metric),
        normalize_entitlement_identity(license_obj.license_type),
    )


def assert_successor_term(predecessors: list[License], successor_start, successor_end) -> None:
    """Require a renewal successor to extend every predecessor's coverage."""
    if not successor_end:
        raise HTTPException(status_code=400, detail="Renewal successor must have an end date")
    for predecessor in predecessors:
        if predecessor.end_date and successor_end <= predecessor.end_date:
            raise HTTPException(
                status_code=400,
                detail="Renewal successor must extend coverage beyond every predecessor end date",
            )
        if predecessor.start_date and (not successor_start or successor_start <= predecessor.start_date):
            raise HTTPException(
                status_code=400,
                detail="Renewal successor must start after every predecessor start date",
            )


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
    if license_obj.license_type in NON_RENEWABLE_LICENSE_TYPES:
        raise HTTPException(status_code=400, detail="Cannot initiate renewal on service or other license types")
    if not (license_obj.budget_owner_email or "").strip():
        raise HTTPException(status_code=400, detail="A budget owner is required before initiating renewal")
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
    """Clear only the unfinished outgoing renewal state."""
    assert_can_cancel_renewal(license_obj)
    license_obj.lifecycle_status = None


def clear_pending_renewal_if_current(license_obj: License) -> None:
    if license_obj.lifecycle_status == "pending_renewal":
        clear_pending_renewal(license_obj)


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

    await _validate_repair_targets(db, license_obj, proposed)
    await _validate_reciprocal_chain_links(db, license_obj, proposed)


async def _validate_repair_targets(db: AsyncSession, license_obj: License, proposed: dict) -> None:
    target_fields = ("renewed_from_id", "renewed_to_id", "predecessor_id")
    target_ids = {proposed[field] for field in target_fields if proposed[field] is not None}
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
        # The reciprocal predecessor -> current edge is expected. A cycle exists
        # only when the current node's outgoing path reaches that predecessor.
        await _assert_no_successor_cycle(
            db,
            start_id=renewed_to_id,
            blocked_id=renewed_from_id,
        )

    if renewed_to_id is not None:
        assert_predecessor_has_no_successor(
            license_obj,
            allowed_successor_id=renewed_to_id,
            status_code=400,
        )
        successor = await db.get(License, renewed_to_id)
        successor_predecessor_ids = set(successor.coterm_from_ids or []) if successor is not None else set()
        if (
            successor is not None
            and successor.renewed_from_id not in (None, license_obj.id)
            and license_obj.id not in successor_predecessor_ids
        ):
            raise HTTPException(
                status_code=400,
                detail="renewed_to_id target already points to a different predecessor.",
            )
        await _assert_no_successor_cycle(db, start_id=renewed_to_id, blocked_id=license_obj.id)


async def _assert_no_successor_cycle(db: AsyncSession, *, start_id: int | None, blocked_id: int) -> None:
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

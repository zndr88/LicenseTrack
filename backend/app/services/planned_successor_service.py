"""Explicit successor relationships between lines of one procurement event."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import LicenseType
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services.license_service import is_renewable_license
from app.services.lifecycle_rules import normalize_entitlement_identity

# Types that never renew, regardless of the Service/Other renewable opt-in.
_NEVER_RENEWED_TYPES = frozenset({LicenseType.freeware, LicenseType.perpetual})


def _assert_acyclic(items: list[SourcingItem], changes: dict[int, int | None]) -> None:
    next_by_id = {item.id: changes.get(item.id, item.successor_sourcing_item_id) for item in items}
    for start in next_by_id:
        seen: set[int] = set()
        current: int | None = start
        while current is not None:
            if current in seen:
                raise HTTPException(status_code=422, detail="Successor links cannot form a cycle")
            seen.add(current)
            current = next_by_id.get(current)


async def require_no_planned_links(db: AsyncSession, item: SourcingItem) -> None:
    incoming = await db.scalar(
        select(SourcingItem.id).where(SourcingItem.successor_sourcing_item_id == item.id).limit(1)
    )
    if item.successor_sourcing_item_id is not None or incoming is not None:
        raise HTTPException(status_code=409, detail="Remove this line's planned successor links first")


async def set_planned_successors(
    db: AsyncSession,
    predecessor_item_ids: list[int],
    successor_item_id: int | None,
) -> None:
    """Set or remove outgoing links while the complete purchase remains editable."""
    if not predecessor_item_ids or len(predecessor_item_ids) != len(set(predecessor_item_ids)):
        raise HTTPException(status_code=422, detail="Choose one or more distinct predecessor lines")
    target_ids = set(predecessor_item_ids)
    if successor_item_id is not None:
        target_ids.add(successor_item_id)
    result = await db.execute(select(SourcingItem).where(SourcingItem.id.in_(target_ids)).with_for_update())
    selected = {item.id: item for item in result.scalars().all()}
    if set(selected) != target_ids:
        raise HTTPException(status_code=404, detail="A selected sourcing line was not found")
    if successor_item_id in predecessor_item_ids:
        raise HTTPException(status_code=422, detail="A line cannot succeed itself")

    predecessors = [selected[item_id] for item_id in predecessor_item_ids]
    successor = selected.get(successor_item_id) if successor_item_id is not None else None
    if successor is not None and any(
        predecessor.successor_sourcing_item_id not in (None, successor_item_id)
        for predecessor in predecessors
    ):
        raise HTTPException(status_code=409, detail="A predecessor already has a planned next term")
    if successor is not None and (successor.renewal_for_license_id is not None or successor.coterm_predecessor_ids):
        raise HTTPException(status_code=422, detail="The successor line already follows existing licenses")

    request_ids = {item.sourcing_request_id for item in selected.values()}
    order_ids = {item.pending_order_id for item in selected.values()}
    if len(request_ids) != 1 or None in request_ids:
        raise HTTPException(status_code=422, detail="Linked lines must belong to one sourcing request")
    if len(order_ids) != 1:
        raise HTTPException(status_code=422, detail="Linked lines must belong to one pending order")
    order_id = next(iter(order_ids))
    if order_id is None:
        if any(item.status != SourcingStatus.sourcing for item in selected.values()):
            raise HTTPException(status_code=409, detail="Linked sourcing lines must still be open")
        all_result = await db.execute(
            select(SourcingItem).where(SourcingItem.sourcing_request_id == next(iter(request_ids)))
        )
    else:
        order = await db.get(PendingOrder, order_id)
        if order is None or order.status not in {PendingOrderStatus.pending, PendingOrderStatus.invoice_received}:
            raise HTTPException(status_code=409, detail="The pending order is no longer editable")
        all_result = await db.execute(select(SourcingItem).where(SourcingItem.pending_order_id == order_id))
    all_items = list(all_result.scalars().all())

    if successor is not None:
        successor_publisher = normalize_entitlement_identity(successor.publisher_name)
        if not successor_publisher:
            raise HTTPException(status_code=422, detail="Successor publisher is required")
        if not is_renewable_license(successor) or successor.license_type in _NEVER_RENEWED_TYPES:
            raise HTTPException(status_code=422, detail="This successor type cannot be renewed")
        if successor.license_type == LicenseType.maintenance:
            raise HTTPException(status_code=422, detail="Planned maintenance successors are not available yet")
        for predecessor in predecessors:
            if normalize_entitlement_identity(predecessor.publisher_name) != successor_publisher:
                raise HTTPException(status_code=422, detail="Linked terms must have the same publisher")
            if not is_renewable_license(predecessor) or predecessor.license_type in _NEVER_RENEWED_TYPES:
                raise HTTPException(status_code=422, detail="This predecessor type cannot be renewed")
            if predecessor.license_type == LicenseType.maintenance:
                raise HTTPException(status_code=422, detail="Planned maintenance successors are not available yet")

    changes = {item_id: successor_item_id for item_id in predecessor_item_ids}
    _assert_acyclic(all_items, changes)
    for predecessor in predecessors:
        predecessor.successor_sourcing_item_id = successor_item_id
    await db.flush()


async def replace_planned_predecessors(
    db: AsyncSession,
    predecessor_item_ids: list[int],
    successor_item_id: int,
) -> None:
    """Replace the incoming set for one line in a single request transaction."""
    successor = await db.get(SourcingItem, successor_item_id)
    if successor is None:
        raise HTTPException(status_code=404, detail="Successor line was not found")
    current_result = await db.execute(
        select(SourcingItem.id).where(SourcingItem.successor_sourcing_item_id == successor_item_id)
    )
    current_ids = set(current_result.scalars().all())
    desired_ids = set(predecessor_item_ids)
    if len(desired_ids) != len(predecessor_item_ids):
        raise HTTPException(status_code=422, detail="Choose distinct predecessor lines")
    removed_ids = sorted(current_ids - desired_ids)
    if removed_ids:
        await set_planned_successors(db, removed_ids, None)
    if predecessor_item_ids:
        await set_planned_successors(db, predecessor_item_ids, successor_item_id)

from datetime import date
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.schemas.sourcing import SourcingItemCreate, SourcingRequestCreate
from app.services.lifecycle_rules import clear_pending_renewal_if_current
from app.services.money import MoneyParseError, parse_money


def is_direct_freeware_item(item: SourcingItem) -> bool:
    if item.license_type != LicenseType.freeware:
        return False
    if item.maintenance_coverage != MaintenanceCoverage.included:
        return True
    try:
        return not bool(parse_money(item.maintenance_cost))
    except MoneyParseError:
        return True


def assert_sourcing_item_editable(item: SourcingItem) -> None:
    """Reject mutations to sourcing items once the sourcing workflow is converted."""
    if item.status == SourcingStatus.converted or item.pending_order_id is not None:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a converted sourcing item")
    if item.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a cancelled sourcing item")
    request = getattr(item, "sourcing_request", None)
    if request is not None and request.status == SourcingStatus.converted:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify an item in a converted sourcing request")
    if request is not None and request.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify an item in a cancelled sourcing request")


def assert_sourcing_request_editable(request: SourcingRequest) -> None:
    if request.status == SourcingStatus.converted:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a converted sourcing request")
    if request.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a cancelled sourcing request")


async def handle_delete_side_effects(
    db: AsyncSession,
    renewal_license_id: int | None,
    parent_order_id: int | None,
) -> None:
    """Apply side effects after a SourcingItem has been deleted from the session.

    1. If the item belonged to a PendingOrder and was its last child, delete
       the now-orphaned PendingOrder.
    2. If the item was a renewal sourcing item and was the last one referencing
       its predecessor license, clear the license's pending_renewal status.
    """
    if parent_order_id is not None:
        remaining = await db.scalar(
            select(func.count()).select_from(SourcingItem).where(SourcingItem.pending_order_id == parent_order_id)
        )
        if remaining == 0:
            orphaned_po = await db.get(PendingOrder, parent_order_id)
            if orphaned_po is not None:
                await db.delete(orphaned_po)

    if renewal_license_id is not None:
        linked_license = await db.get(License, renewal_license_id)
        if linked_license is not None:
            sibling_count = await db.scalar(
                select(func.count())
                .select_from(SourcingItem)
                .where(SourcingItem.renewal_for_license_id == renewal_license_id)
            )
            if sibling_count == 0:
                clear_pending_renewal_if_current(linked_license)


async def clear_pending_renewal_if_no_open_sourcing(db: AsyncSession, renewal_license_id: int) -> None:
    linked_license = await db.get(License, renewal_license_id)
    if linked_license is None:
        return
    sibling_count = await db.scalar(
        select(func.count())
        .select_from(SourcingItem)
        .where(
            SourcingItem.renewal_for_license_id == renewal_license_id,
            SourcingItem.status != SourcingStatus.cancelled,
        )
    )
    if sibling_count == 0:
        clear_pending_renewal_if_current(linked_license)


async def delete_empty_sourcing_requests(
    db: AsyncSession,
    request_ids: set[int],
) -> None:
    """Delete candidate sourcing requests that are still open and have no items."""
    if not request_ids:
        return

    result = await db.execute(
        select(SourcingRequest)
        .outerjoin(SourcingItem, SourcingItem.sourcing_request_id == SourcingRequest.id)
        .where(
            SourcingRequest.id.in_(request_ids),
            SourcingRequest.status == SourcingStatus.sourcing,
        )
        .group_by(SourcingRequest.id)
        .having(func.count(SourcingItem.id) == 0)
    )
    for request in result.scalars().all():
        await db.delete(request)


def build_merged_sourcing_item(
    items: list[SourcingItem],
    predecessors: list[License],
    created_by: int | None,
) -> SourcingItem:
    """Build a merged coterm SourcingItem from validated items and their predecessor licenses.

    Assumes all items and predecessors have already been validated (status checks,
    renewal checks, eligibility checks). The caller is responsible for persisting
    the returned item and deleting the originals.
    """

    def _sort_key(lic: License) -> tuple:
        return (lic.start_date or date.min, lic.id)

    sorted_preds = sorted(predecessors, key=_sort_key)
    primary_pred = sorted_preds[0]
    primary_item = next(item for item in items if item.renewal_for_license_id == primary_pred.id)

    def _parse_qty(q: str | None) -> int:
        try:
            return int(q) if q else 0
        except (ValueError, TypeError):
            return 0

    total_quantity = sum(_parse_qty(item.quantity) for item in items)

    unit_price_str = primary_item.estimated_unit_price
    if unit_price_str and unit_price_str.strip():
        try:
            merged_total_price = f"{float(unit_price_str) * total_quantity:.2f}"
        except (ValueError, TypeError):
            merged_total_price = None
    else:
        merged_total_price = None

    return SourcingItem(
        publisher_name=primary_item.publisher_name,
        software_description=primary_item.software_description,
        quantity=str(total_quantity) if total_quantity else None,
        estimated_unit_price=primary_item.estimated_unit_price,
        estimated_total_price=merged_total_price,
        currency=primary_item.currency,
        supplier=primary_item.supplier,
        contact_email=primary_item.contact_email,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=primary_pred.id,
        coterm_predecessor_ids=[lic.id for lic in sorted_preds],
        created_by=created_by,
    )


async def ensure_sourcing_request_for_item(
    db: AsyncSession,
    item: SourcingItem,
    *,
    created_by: int | None,
) -> SourcingRequest:
    if item.sourcing_request_id is not None:
        request = await db.get(SourcingRequest, item.sourcing_request_id)
        if request is not None:
            return request

    request = SourcingRequest(
        supplier=item.supplier,
        contact_email=item.contact_email,
        notes=item.notes,
        status=item.status,
        created_by=created_by if created_by is not None else item.created_by,
    )
    db.add(request)
    await db.flush()
    item.sourcing_request_id = request.id
    return request


async def list_sourcing_request_records(db: AsyncSession) -> list[SourcingRequest]:
    await backfill_missing_sourcing_requests(db)
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.status == SourcingStatus.sourcing)
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .order_by(SourcingRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def list_sourcing_request_history_records(db: AsyncSession) -> list[SourcingRequest]:
    await backfill_missing_sourcing_requests(db)
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.status.in_([SourcingStatus.converted, SourcingStatus.cancelled]))
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .order_by(SourcingRequest.updated_at.desc(), SourcingRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def get_sourcing_request_or_404(db: AsyncSession, request_id: int) -> SourcingRequest:
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.id == request_id)
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .execution_options(populate_existing=True)
    )
    request = result.scalar_one_or_none()
    if request is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Sourcing request not found")
    return request


async def create_sourcing_request_record(
    db: AsyncSession,
    payload: SourcingRequestCreate,
    *,
    created_by: int,
) -> SourcingRequest:
    if not payload.items:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="At least one sourcing item is required")

    request = SourcingRequest(
        supplier=payload.supplier,
        contact_email=payload.contact_email,
        notes=payload.notes,
        status=SourcingStatus.sourcing,
        created_by=created_by,
    )
    db.add(request)
    await db.flush()

    created_items: list[SourcingItem] = []
    for index, item_payload in enumerate(payload.items):
        parent_index = item_payload.parent_item_index
        if parent_index is not None and not 0 <= parent_index < index:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=422,
                detail=f"Item {index + 1} has an invalid maintenance parent",
            )

        target_request = request
        parent_item = created_items[parent_index] if parent_index is not None else None
        if parent_item is not None:
            parent_supplier = (parent_item.supplier or request.supplier or "").strip().casefold()
            child_supplier = (item_payload.supplier or request.supplier or "").strip().casefold()
            if child_supplier and child_supplier != parent_supplier:
                target_request = SourcingRequest(
                    supplier=item_payload.supplier,
                    contact_email=item_payload.contact_email or payload.contact_email,
                    notes=payload.notes,
                    status=SourcingStatus.sourcing,
                    created_by=created_by,
                )
                db.add(target_request)
                await db.flush()

        item = _build_request_item(
            item_payload,
            request_id=target_request.id,
            created_by=created_by,
        )
        if parent_item is not None:
            item.parent_sourcing_item_id = parent_item.id
        db.add(item)
        await db.flush()
        created_items.append(item)
    return request


async def add_sourcing_request_item_record(
    db: AsyncSession,
    request_id: int,
    payload: SourcingItemCreate,
    *,
    created_by: int,
) -> SourcingRequest:
    request = await get_sourcing_request_or_404(db, request_id)
    assert_sourcing_request_editable(request)
    db.add(_build_request_item(payload, request_id=request.id, created_by=created_by))
    await db.flush()
    return request


async def delete_sourcing_request_record(db: AsyncSession, request_id: int) -> str:
    request = await get_sourcing_request_or_404(db, request_id)
    assert_sourcing_request_editable(request)
    if any(item.status == SourcingStatus.converted for item in request.items):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409,
            detail="Cannot delete a sourcing request after any line has been converted",
        )

    label = request.supplier or f"Sourcing request {request.id}"
    renewal_ids = [
        item.renewal_for_license_id
        for item in request.items
        if item.status == SourcingStatus.sourcing and item.renewal_for_license_id
    ]
    await db.delete(request)
    await db.flush()
    for renewal_id in renewal_ids:
        await handle_delete_side_effects(db, renewal_license_id=renewal_id, parent_order_id=None)
    return label


async def cancel_sourcing_request_record(db: AsyncSession, request_id: int) -> SourcingRequest:
    request = await get_sourcing_request_or_404(db, request_id)
    assert_sourcing_request_editable(request)

    renewal_ids = [
        item.renewal_for_license_id
        for item in request.items
        if item.status == SourcingStatus.sourcing and item.renewal_for_license_id
    ]
    request.status = SourcingStatus.cancelled
    for item in request.items:
        if item.status == SourcingStatus.sourcing:
            item.status = SourcingStatus.cancelled
    await db.flush()
    for renewal_id in renewal_ids:
        await clear_pending_renewal_if_no_open_sourcing(db, renewal_id)
    return request


async def backfill_missing_sourcing_requests(db: AsyncSession) -> None:
    result = await db.execute(select(SourcingItem).where(SourcingItem.sourcing_request_id.is_(None)))
    items = list(result.scalars().all())
    if not items:
        return
    for item in items:
        await ensure_sourcing_request_for_item(db, item, created_by=item.created_by)
    await db.flush()


def _build_request_item(
    payload: SourcingItemCreate,
    *,
    request_id: int,
    created_by: int,
) -> SourcingItem:
    item_data = payload.model_dump(by_alias=False)
    item_data.pop("sourcing_request_id", None)
    item_data.pop("status", None)
    item_data.pop("parent_item_index", None)
    if item_data.get("license_type") == LicenseType.freeware:
        item_data["estimated_unit_price"] = None
        item_data["estimated_total_price"] = None
    return SourcingItem(
        **item_data,
        sourcing_request_id=request_id,
        status=SourcingStatus.sourcing,
        created_by=created_by,
    )


async def convert_sourcing_item_to_order(
    db: AsyncSession,
    item: SourcingItem,
    pending_order_id: int | None,
    po_number: str | None,
    supplier: str | None,
    notes: str | None,
    created_by: int | None,
) -> PendingOrder:
    """Attach a sourcing item to a PendingOrder (existing or newly created).

    Mutates item.pending_order_id and item.status in place. Flushes but does
    not commit - the caller controls the transaction boundary.

    Raises ValueError if:
    - pending_order_id is given but the order doesn't exist
    - pending_order_id is None and po_number is empty/None
    """
    if is_direct_freeware_item(item):
        raise ValueError("Freeware / Open Source items convert directly to the License Registry")

    if pending_order_id is not None:
        order = await db.get(PendingOrder, pending_order_id)
        if order is None:
            raise ValueError("Pending order not found")
    else:
        if not po_number:
            raise ValueError("po_number is required when pending_order_id is not provided")
        order = PendingOrder(
            po_number=po_number,
            supplier=supplier,
            notes=notes,
            created_by=created_by,
        )
        db.add(order)
        await db.flush()

    item.pending_order_id = order.id
    item.status = SourcingStatus.converted
    if item.sourcing_request_id is not None:
        request = await db.get(SourcingRequest, item.sourcing_request_id)
        await refresh_sourcing_request_status(db, request)
    return order


async def convert_sourcing_request_to_order(
    db: AsyncSession,
    request: SourcingRequest,
    pending_order_id: int | None,
    po_number: str | None,
    supplier: str | None,
    notes: str | None,
    created_by: int | None,
) -> PendingOrder:
    """Attach the open purchase items in a sourcing request to a PendingOrder."""
    if request.status == SourcingStatus.converted:
        raise ValueError("Sourcing request has already been converted")

    purchase_items = [
        item
        for item in request.items
        if item.status == SourcingStatus.sourcing and not is_direct_freeware_item(item)
    ]
    if not purchase_items:
        raise ValueError("No purchase items are available to convert to a pending order")

    if pending_order_id is not None:
        order = await db.get(PendingOrder, pending_order_id)
        if order is None:
            raise ValueError("Pending order not found")
    else:
        if not po_number:
            raise ValueError("po_number is required when pending_order_id is not provided")
        order = PendingOrder(
            po_number=po_number,
            supplier=supplier or request.supplier,
            notes=notes if notes is not None else request.notes,
            created_by=created_by,
        )
        db.add(order)
        await db.flush()

    for item in purchase_items:
        item.pending_order_id = order.id
        item.status = SourcingStatus.converted
    await refresh_sourcing_request_status(db, request)
    return order


async def refresh_sourcing_request_status(
    db: AsyncSession,
    request: SourcingRequest,
) -> None:
    """Close a request only after every line has completed its own path."""
    await db.flush()
    remaining = await db.scalar(
        select(func.count())
        .select_from(SourcingItem)
        .where(
            SourcingItem.sourcing_request_id == request.id,
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    if remaining == 0:
        request.status = SourcingStatus.converted

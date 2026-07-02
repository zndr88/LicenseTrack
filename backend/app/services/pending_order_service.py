"""
Pending-order CRUD and item-management workflow helpers.

These helpers keep the route layer focused on HTTP/auth concerns while
preserving the existing business rules around deletions and item creation.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import ProcurementDocument
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.schemas.document import ProcurementDocumentResponse
from app.services import storage
from app.schemas.pending_order import PendingOrderCreate, PendingOrderResponse, PendingOrderUpdate, SourcingItemSummary
from app.schemas.sourcing import SourcingItemCreate, SourcingItemUpdate


def to_pending_order_response(order: PendingOrder) -> PendingOrderResponse:
    items = list(order.items) if "items" in order.__dict__ else []
    documents = list(order.documents) if "documents" in order.__dict__ else []
    return PendingOrderResponse.model_validate({
        "id": order.id,
        "po_number": order.po_number,
        "supplier": order.supplier,
        "notes": order.notes,
        "status": order.status,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "created_by": order.created_by,
        "evidence_transfer_status": order.evidence_transfer_status,
        "evidence_transfer_detail": order.evidence_transfer_detail,
        "evidence_transfer_failed_at": order.evidence_transfer_failed_at,
        "items": [SourcingItemSummary.model_validate(item) for item in items],
        "documents": [ProcurementDocumentResponse.model_validate(document) for document in documents],
    })


async def get_pending_order_or_404(
    db: AsyncSession,
    order_id: int,
    *,
    include_items: bool = True,
) -> PendingOrder:
    query = select(PendingOrder).where(PendingOrder.id == order_id)
    if include_items:
        query = query.options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
        )
    result = await db.execute(query)
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Pending order not found")
    return order


async def list_pending_order_records(
    db: AsyncSession,
    *,
    limit: int | None,
    offset: int,
) -> list[PendingOrder]:
    query = (
        select(PendingOrder)
        .where(PendingOrder.status != PendingOrderStatus.converted)
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
        )
        .order_by(PendingOrder.created_at.desc())
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_pending_order_record(
    db: AsyncSession,
    payload: PendingOrderCreate,
    *,
    created_by: int,
) -> PendingOrder:
    order = PendingOrder(**payload.model_dump(by_alias=False), created_by=created_by)
    db.add(order)
    await db.flush()
    return order


async def apply_pending_order_update(
    db: AsyncSession,
    order_id: int,
    payload: PendingOrderUpdate,
) -> tuple[PendingOrder, dict, dict]:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="update")
    before = {column.name: getattr(order, column.name) for column in order.__table__.columns}

    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    for field, value in update_data.items():
        setattr(order, field, value)

    after = {column.name: getattr(order, column.name) for column in order.__table__.columns}
    return order, before, after


async def delete_pending_order_record(db: AsyncSession, order_id: int) -> str:
    order = await get_pending_order_or_404(db, order_id, include_items=False)
    if order.status != PendingOrderStatus.pending:
        raise HTTPException(
            status_code=409,
            detail="Only pending orders with status 'pending' can be deleted",
        )

    items_result = await db.execute(
        select(SourcingItem).where(SourcingItem.pending_order_id == order_id)
    )
    for item in items_result.scalars().all():
        item.status = SourcingStatus.sourcing

    docs_result = await db.execute(
        select(ProcurementDocument).where(ProcurementDocument.pending_order_id == order_id)
    )
    docs = docs_result.scalars().all()
    stored_paths = [doc.filename for doc in docs]
    for doc in docs:
        await db.delete(doc)

    label = order.po_number or order.supplier or str(order_id)
    await db.delete(order)
    return label, stored_paths


async def add_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    payload: SourcingItemCreate,
    *,
    created_by: int,
) -> PendingOrder:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="add items to")

    db.add(_build_pending_order_item(payload, order_id=order_id, created_by=created_by))
    return order


async def add_pending_order_items_bulk_record(
    db: AsyncSession,
    order_id: int,
    payload: list[SourcingItemCreate],
    *,
    created_by: int,
) -> PendingOrder:
    if not payload:
        raise HTTPException(status_code=422, detail="At least one item is required")

    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="add items to")

    for item_payload in payload:
        db.add(_build_pending_order_item(item_payload, order_id=order_id, created_by=created_by))

    return order


async def update_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    item_id: int,
    payload: SourcingItemUpdate,
) -> PendingOrder:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="update items on")

    item = _find_order_item(order, item_id)
    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    update_data.pop("status", None)
    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    return order


async def delete_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    item_id: int,
) -> tuple[PendingOrder, str, int | None]:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="delete items from")

    item = _find_order_item(order, item_id)
    label = f"{item.publisher_name} - {item.software_description}"
    renewal_license_id = item.renewal_for_license_id
    await db.delete(item)
    order.items = [existing for existing in order.items if existing.id != item_id]
    await db.flush()
    return order, label, renewal_license_id


def ensure_pending_order_editable(order: PendingOrder, *, action: str = "modify") -> None:
    if order.status == PendingOrderStatus.converted:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a converted order")


def _find_order_item(order: PendingOrder, item_id: int) -> SourcingItem:
    for item in order.items:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Pending order item not found")


def _build_pending_order_item(
    payload: SourcingItemCreate,
    *,
    order_id: int,
    created_by: int,
) -> SourcingItem:
    item_data = payload.model_dump(by_alias=False)
    item_data.pop("status", None)
    item_data.pop("renewal_for_license_id", None)
    item_data.pop("sourcing_request_id", None)

    return SourcingItem(
        **item_data,
        status=SourcingStatus.converted,
        pending_order_id=order_id,
        created_by=created_by,
    )

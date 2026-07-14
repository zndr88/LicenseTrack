from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.user import User
from app.schemas.pending_order import (
    PendingOrderResponse,
)
from app.schemas.sourcing import SourcingItemCreate, SourcingItemUpdate
from app.services.audit_service import log_event
from app.services.pending_order_service import (
    add_pending_order_item_record,
    add_pending_order_items_bulk_record,
    delete_pending_order_item_record,
    get_pending_order_or_404,
    to_pending_order_response,
    update_pending_order_item_record,
)
from app.services.sourcing_service import handle_delete_side_effects

router = APIRouter(prefix="/api/pending-orders", tags=["pending-orders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/{order_id}/items", response_model=PendingOrderResponse, status_code=201)
async def add_pending_order_item(
    order_id: int,
    payload: SourcingItemCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    """Add a new line item to an existing pending order without converting it."""
    order = await add_pending_order_item_record(
        db,
        order_id,
        payload,
        created_by=current_user.id,
    )

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.item_added",
        actor=current_user,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order.po_number or order.supplier or "",
        detail=f"{payload.publisher_name} — {payload.software_description}",
    )
    await db.commit()
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)


@router.post("/{order_id}/items/bulk", response_model=PendingOrderResponse, status_code=201)
async def add_pending_order_items_bulk(
    order_id: int,
    payload: list[SourcingItemCreate],
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    """Add multiple line items to an existing pending order in one transaction."""
    order = await add_pending_order_items_bulk_record(
        db,
        order_id,
        payload,
        created_by=current_user.id,
    )

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.items_added",
        actor=current_user,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order.po_number or order.supplier or "",
        detail=f"{len(payload)} item(s) added",
    )
    await db.commit()
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)


@router.put("/{order_id}/items/{item_id}", response_model=PendingOrderResponse)
async def update_pending_order_item(
    order_id: int,
    item_id: int,
    payload: SourcingItemUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    """Update a pending-order line item before the PO is converted to licenses."""
    order = await update_pending_order_item_record(db, order_id, item_id, payload)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.item_updated",
        actor=_editor,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order.po_number or order.supplier or "",
        detail=f"item {item_id}",
    )
    await db.commit()
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)


@router.delete("/{order_id}/items/{item_id}", response_model=PendingOrderResponse)
async def delete_pending_order_item(
    order_id: int,
    item_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    """Delete a pending-order line item before the PO is converted to licenses."""
    order, label, renewal_license_id = await delete_pending_order_item_record(db, order_id, item_id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.item_deleted",
        actor=_editor,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order.po_number or order.supplier or "",
        detail=label,
    )
    await handle_delete_side_effects(db, renewal_license_id=renewal_license_id, parent_order_id=None)
    await db.commit()
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)

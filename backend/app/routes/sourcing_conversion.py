from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingRequest
from app.models.user import User
from app.schemas.pending_order import ConvertSourcingItemRequest, PendingOrderResponse
from app.services.audit_service import log_event
from app.services.pending_order_service import to_pending_order_response
from app.services.sourcing_service import (
    assert_sourcing_item_editable,
    convert_sourcing_item_to_order,
    convert_sourcing_request_to_order,
    ensure_sourcing_request_for_item,
    get_sourcing_request_or_404,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/requests/{request_id}/convert", response_model=PendingOrderResponse, status_code=200)
async def convert_sourcing_request(
    request_id: int,
    payload: ConvertSourcingItemRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    try:
        order = await convert_sourcing_request_to_order(
            db,
            sourcing_request,
            pending_order_id=payload.pending_order_id,
            po_number=payload.po_number,
            supplier=payload.supplier,
            notes=payload.notes,
            created_by=current_user.id,
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc) else 422
        if "already been converted" in str(exc):
            status_code = 409
        raise HTTPException(status_code=status_code, detail=str(exc))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_request.converted",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
    )
    await db.commit()

    po_result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order.id)
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
        )
    )
    order = po_result.scalar_one()
    return to_pending_order_response(order)

@router.post("/{item_id}/convert", response_model=PendingOrderResponse, status_code=200)
async def convert_sourcing_item(
    item_id: int,
    payload: ConvertSourcingItemRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    """Convert a sourcing item to (or attach it to) a pending order."""
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request))
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")
    assert_sourcing_item_editable(item)

    try:
        await ensure_sourcing_request_for_item(db, item, created_by=current_user.id)
        order = await convert_sourcing_item_to_order(
            db, item,
            pending_order_id=payload.pending_order_id,
            po_number=payload.po_number,
            supplier=payload.supplier,
            notes=payload.notes,
            created_by=current_user.id,
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.converted",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item_id),
        target_label=item.software_description,
    )
    await db.commit()

    # Reload with items
    po_result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order.id)
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
        )
    )
    order = po_result.scalar_one()
    return to_pending_order_response(order)

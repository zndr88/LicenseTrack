from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.user import User
from app.schemas.pending_order import (
    PendingOrderCreate,
    PendingOrderResponse,
    PendingOrderUpdate,
)
from app.services import storage
from app.services.audit_service import diff_fields, log_event
from app.services.pending_order_service import (
    apply_pending_order_update,
    create_pending_order_record,
    delete_pending_order_record,
    get_pending_order_or_404,
    list_pending_order_records,
    to_pending_order_response,
)

router = APIRouter(prefix="/api/pending-orders", tags=["pending-orders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]



@router.get("", response_model=list[PendingOrderResponse])
async def list_pending_orders(
    db: DbSession,
    _current_user: CurrentUser,
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[PendingOrderResponse]:
    orders = await list_pending_order_records(db, limit=limit, offset=offset)
    return [to_pending_order_response(order) for order in orders]


@router.get("/{order_id}", response_model=PendingOrderResponse)
async def get_pending_order(
    order_id: int,
    db: DbSession,
    _current_user: CurrentUser,
) -> PendingOrderResponse:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)


@router.post("", response_model=PendingOrderResponse, status_code=201)
async def create_pending_order(
    payload: PendingOrderCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    order = await create_pending_order_record(db, payload, created_by=current_user.id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.created",
        actor=current_user,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order.id),
        target_label=order.po_number or order.supplier or "",
    )
    await db.commit()
    await db.refresh(order, ["items"])
    return to_pending_order_response(order)


@router.put("/{order_id}", response_model=PendingOrderResponse)
async def update_pending_order(
    order_id: int,
    payload: PendingOrderUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    order, before, after = await apply_pending_order_update(db, order_id, payload)

    diff = diff_fields(before, after)
    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "po.updated",
            actor=_editor,
            ip_address=ip,
            target_type="pending_order",
            target_id=str(order_id),
            target_label=order.po_number or order.supplier or "",
            detail=diff,
        )

    await db.commit()
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    return to_pending_order_response(order)


@router.delete("/{order_id}", status_code=204, response_class=Response)
async def delete_pending_order(
    order_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    label, stored_paths = await delete_pending_order_record(db, order_id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "po.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=label,
    )
    await db.commit()
    if stored_paths:
        storage_base = await storage.resolve_storage_path(db)
        for path in stored_paths:
            storage.delete_file(path, storage_base)
    return Response(status_code=204)

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.models.user import User
from app.schemas.license import LicenseResponse
from app.schemas.pending_order import ConvertSourcingItemRequest, PendingOrderResponse
from app.services.audit_service import diff_fields, log_event
from app.services.pending_order_service import to_pending_order_response
from app.services.conversion_response_service import build_conversion_response
from app.services.sourcing_license_conversion_service import convert_freeware_sourcing_items
from app.services.sourcing_service import (
    assert_sourcing_item_editable,
    convert_sourcing_item_to_order,
    convert_sourcing_request_to_order,
    ensure_sourcing_request_for_item,
    get_sourcing_request_or_404,
    get_sourcing_request_for_update_or_404,
    is_direct_freeware_item,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/requests/{request_id}/convert-freeware",
    response_model=list[LicenseResponse],
    status_code=200,
)
async def convert_freeware_sourcing_request(
    request_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> list[LicenseResponse]:
    sourcing_request = await get_sourcing_request_for_update_or_404(db, request_id)
    identity_before = {
        "supplier": sourcing_request.supplier,
        "contact_email": sourcing_request.contact_email,
    }
    open_items = [
        item for item in sourcing_request.items if item.status == SourcingStatus.sourcing
    ]
    if any(not is_direct_freeware_item(item) for item in open_items):
        raise HTTPException(
            status_code=422,
            detail="Convert purchase lines to a pending order before converting this request directly",
        )

    licenses = await convert_freeware_sourcing_items(
        db=db,
        items=open_items,
        created_by=current_user.id,
    )
    ip = request.client.host if request.client else None
    identity_diff = diff_fields(
        identity_before,
        {
            "supplier": sourcing_request.supplier,
            "contact_email": sourcing_request.contact_email,
        },
    )
    if identity_diff:
        await log_event(
            db,
            "sourcing_request.updated",
            actor=current_user,
            ip_address=ip,
            target_type="sourcing_request",
            target_id=str(request_id),
            target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
            detail=identity_diff,
        )
    await log_event(
        db,
        "sourcing_request.converted_directly",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
        detail=f"{len(licenses)} Freeware / Open Source license(s) created",
    )
    await db.commit()
    return await build_conversion_response(
        db,
        [(license_obj.id, "direct_freeware") for license_obj in licenses],
        [],
    )


@router.post(
    "/{item_id}/convert-freeware",
    response_model=LicenseResponse,
    status_code=200,
)
async def convert_freeware_sourcing_item(
    item_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request))
        .with_for_update()
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")

    licenses = await convert_freeware_sourcing_items(
        db=db,
        items=[item],
        created_by=current_user.id,
    )
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.converted_directly",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item_id),
        target_label=item.software_description,
        detail=f"License {licenses[0].license_ref} created without a pending order",
    )
    await db.commit()
    responses = await build_conversion_response(
        db,
        [(licenses[0].id, "direct_freeware")],
        [],
    )
    return responses[0]


@router.post("/requests/{request_id}/convert", response_model=PendingOrderResponse, status_code=200)
async def convert_sourcing_request(
    request_id: int,
    payload: ConvertSourcingItemRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PendingOrderResponse:
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    freeware_items = [
        item
        for item in sourcing_request.items
        if item.status == SourcingStatus.sourcing
        and is_direct_freeware_item(item)
        and item.renewal_for_license_id is None
    ]
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
        direct_licenses = (
            await convert_freeware_sourcing_items(
                db=db,
                items=freeware_items,
                created_by=current_user.id,
            )
            if freeware_items
            else []
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc) else 422
        if "already been converted" in str(exc):
            status_code = 409
        raise HTTPException(status_code=status_code, detail=str(exc))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        (
            "sourcing_request.converted"
            if sourcing_request.status == SourcingStatus.converted
            else "sourcing_request.purchase_lines_converted"
        ),
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
    response = to_pending_order_response(order)
    response.direct_registry_count = len(direct_licenses)
    return response


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
        .options(selectinload(SourcingItem.sourcing_request).selectinload(SourcingRequest.items))
        .with_for_update()
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")
    assert_sourcing_item_editable(item)
    sourcing_request = item.sourcing_request
    identity_before = (
        {
            "supplier": sourcing_request.supplier,
            "contact_email": sourcing_request.contact_email,
        }
        if sourcing_request is not None
        else None
    )

    try:
        await ensure_sourcing_request_for_item(db, item, created_by=current_user.id)
        order = await convert_sourcing_item_to_order(
            db,
            item,
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
    if identity_before is not None:
        identity_diff = diff_fields(
            identity_before,
            {
                "supplier": sourcing_request.supplier,
                "contact_email": sourcing_request.contact_email,
            },
        )
        if identity_diff:
            await log_event(
                db,
                "sourcing_request.updated",
                actor=current_user,
                ip_address=ip,
                target_type="sourcing_request",
                target_id=str(sourcing_request.id),
                target_label=sourcing_request.supplier or f"Sourcing request {sourcing_request.id}",
                detail=identity_diff,
            )
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

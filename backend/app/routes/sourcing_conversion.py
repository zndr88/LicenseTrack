from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.sourcing import SourcingStatus
from app.models.user import User
from app.schemas.license import LicenseResponse
from app.schemas.pending_order import ConvertSourcingItemRequest, PendingOrderResponse
from app.services.audit_service import diff_fields, log_event
from app.services.document_availability_service import get_document_storage_base
from app.services.pending_order_service import to_pending_order_response
from app.services.conversion_response_service import build_conversion_response
from app.services.sourcing_service import (
    convert_freeware_sourcing_item_record,
    convert_freeware_sourcing_request_record,
    convert_sourcing_item_workflow,
    convert_sourcing_request_workflow,
    load_sourcing_conversion_order,
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
    outcome = await convert_freeware_sourcing_request_record(
        db,
        request_id,
        created_by=current_user.id,
    )
    sourcing_request = outcome.request
    ip = request.client.host if request.client else None
    identity_diff = diff_fields(outcome.identity_before, outcome.identity_after)
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
        detail=f"{len(outcome.licenses)} Freeware / Open Source license(s) created",
    )
    await db.commit()
    return await build_conversion_response(
        db,
        [(license_obj.id, "direct_freeware") for license_obj in outcome.licenses],
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
    outcome = await convert_freeware_sourcing_item_record(
        db,
        item_id,
        created_by=current_user.id,
    )
    item = outcome.item
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.converted_directly",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item_id),
        target_label=item.software_description,
        detail=f"License {outcome.license.license_ref} created without a pending order",
    )
    await db.commit()
    responses = await build_conversion_response(
        db,
        [(outcome.license.id, "direct_freeware")],
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
    try:
        outcome = await convert_sourcing_request_workflow(
            db,
            request_id,
            pending_order_id=payload.pending_order_id,
            po_number=payload.po_number,
            procurement_reference=payload.procurement_reference,
            supplier=payload.supplier,
            notes=payload.notes,
            created_by=current_user.id,
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc) else 422
        if "already been converted" in str(exc):
            status_code = 409
        raise HTTPException(status_code=status_code, detail=str(exc))
    sourcing_request = outcome.request

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

    order = await load_sourcing_conversion_order(db, outcome.order_id)
    storage_base = await get_document_storage_base(db)
    response = to_pending_order_response(order, storage_base)
    response.direct_registry_count = outcome.direct_registry_count
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
    try:
        outcome = await convert_sourcing_item_workflow(
            db,
            item_id,
            pending_order_id=payload.pending_order_id,
            po_number=payload.po_number,
            procurement_reference=payload.procurement_reference,
            supplier=payload.supplier,
            notes=payload.notes,
            created_by=current_user.id,
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc))
    item = outcome.item
    sourcing_request = outcome.request

    ip = request.client.host if request.client else None
    if outcome.identity_before is not None:
        identity_diff = diff_fields(outcome.identity_before, outcome.identity_after)
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

    order = await load_sourcing_conversion_order(db, outcome.order_id)
    storage_base = await get_document_storage_base(db)
    return to_pending_order_response(order, storage_base)

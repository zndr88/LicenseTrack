from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.sourcing import SourcingRequest
from app.models.user import User
from app.schemas.license import (
    CancelRenewalResponse,
    InitiateRenewalBundleRequest,
    InitiateRenewalBundleResponse,
    InitiateRenewalResponse,
    LinkExistingSuccessorRequest,
    LinkExistingSuccessorResponse,
)
from app.schemas.sourcing import SourcingItemResponse
from app.services import renewal_orchestrator
from app.services.document_availability_service import get_document_storage_base
from app.services.license_response_service import (
    get_notification_days,
    load_enriched_license_response,
    load_enriched_license_responses,
)
from app.services.sourcing_service import to_sourcing_request_response

router = APIRouter(prefix="/api/licenses", tags=["license-renewals"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

@router.post("/{license_id}/cancel-renewal", response_model=CancelRenewalResponse)
async def cancel_renewal(
    license_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> CancelRenewalResponse:
    """
    Cancel a pending renewal for a license.

    Clears lifecycle_status back to active (null) and cancels the associated
    sourcing request if it has not yet been promoted to a PO. If a PO already
    exists (sourcing item status == "converted"), a po_warning flag is set in
    the response so the frontend can prompt the user to clean it up manually.
    """
    result = await renewal_orchestrator.cancel_renewal(
        db=db,
        license_id=license_id,
        actor=_editor,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    return CancelRenewalResponse(
        license=await load_enriched_license_response(db, license_id),
        po_warning=result.po_warning,
    )


@router.post("/{license_id}/initiate-renewal", response_model=InitiateRenewalResponse)
async def initiate_renewal(
    license_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> InitiateRenewalResponse:
    """
    Begin the renewal pipeline for an existing license.

    Sets the license lifecycle_status to "pending_renewal" and creates a SourcingItem
    pre-filled with the license's data so it can flow through the normal
    sourcing → pending order → convert pipeline. When the PO is eventually converted,
    the backend will UPDATE this license with the new dates/contract details instead
    of creating a new record.
    """
    result = await renewal_orchestrator.initiate_renewal(
        db=db,
        license_id=license_id,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()
    await db.refresh(result.sourcing_item)

    return InitiateRenewalResponse(
        license=await load_enriched_license_response(db, license_id),
        sourcing_item=SourcingItemResponse.model_validate(result.sourcing_item),
    )


@router.post("/{license_id}/link-existing-successor", response_model=LinkExistingSuccessorResponse)
async def link_existing_successor(
    license_id: int,
    payload: LinkExistingSuccessorRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LinkExistingSuccessorResponse:
    """Complete a renewal by adopting an existing purchased License row."""
    notification_days = await get_notification_days(db)
    result = await renewal_orchestrator.link_existing_successor(
        db=db,
        predecessor_id=license_id,
        successor_id=payload.successor_license_id,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        notification_days=notification_days,
    )
    await db.commit()

    responses = await load_enriched_license_responses(db, [result.predecessor.id, result.successor.id])
    return LinkExistingSuccessorResponse(
        predecessor=responses[result.predecessor.id],
        successor=responses[result.successor.id],
        former_successor_license_ref=result.former_successor_license_ref,
    )


@router.post("/{license_id}/unlink-existing-successor", response_model=LinkExistingSuccessorResponse)
async def unlink_existing_successor(
    license_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LinkExistingSuccessorResponse:
    """Undo a link created by the existing-purchase renewal path."""
    result = await renewal_orchestrator.unlink_existing_successor(
        db=db,
        predecessor_id=license_id,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    responses = await load_enriched_license_responses(db, [result.predecessor.id, result.successor.id])
    return LinkExistingSuccessorResponse(
        predecessor=responses[result.predecessor.id],
        successor=responses[result.successor.id],
        former_successor_license_ref=result.former_successor_license_ref,
    )


@router.post("/renewal-bundle/initiate", response_model=InitiateRenewalBundleResponse)
async def initiate_renewal_bundle(
    payload: InitiateRenewalBundleRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> InitiateRenewalBundleResponse:
    """
    Begin one renewal procurement request for multiple licenses.

    Used for same-PO, same-end-date renewal bundles where products must remain
    separate line items instead of being coterm-merged into one license.
    """
    result = await renewal_orchestrator.initiate_renewal_bundle(
        db=db,
        license_ids=payload.license_ids,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    license_ids = [license_obj.id for license_obj in result.licenses]
    responses = await load_enriched_license_responses(db, license_ids)
    storage_base = await get_document_storage_base(db)

    request_result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.id == result.sourcing_request.id)
        .options(selectinload(SourcingRequest.items), selectinload(SourcingRequest.quote_documents))
    )
    sourcing_request = request_result.scalar_one()

    return InitiateRenewalBundleResponse(
        licenses=[responses[license_id] for license_id in license_ids],
        sourcing_request=to_sourcing_request_response(sourcing_request, storage_base),
    )

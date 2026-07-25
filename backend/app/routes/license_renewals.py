from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.license import License
from app.models.sourcing import SourcingRequest
from app.models.user import User
from app.schemas.license import (
    CancelRenewalResponse,
    InitiateRenewalBundleRequest,
    InitiateRenewalBundleResponse,
    InitiateRenewalResponse,
    LicenseResponse,
)
from app.schemas.sourcing import SourcingItemResponse, SourcingRequestResponse
from app.services import renewal_orchestrator
from app.services.license_service import (
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.settings_service import get_global_settings as _get_cached_global_settings

router = APIRouter(prefix="/api/licenses", tags=["license-renewals"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_DEFAULT_NOTIFICATION_DAYS = 30


async def _get_global_settings(db: AsyncSession) -> dict:
    gs = await _get_cached_global_settings(db)
    return gs.mandatory_fields or {} if gs else {}


def _enrich(
    license_obj: License,
    mandatory_fields: dict,
    notification_days: int = _DEFAULT_NOTIFICATION_DAYS,
) -> LicenseResponse:
    today = date.today()
    docs = list(license_obj.documents)
    response = LicenseResponse.model_validate(license_obj)
    response.completeness_pct = compute_completeness(license_obj, docs, mandatory_fields)
    response.days_until_expiry = compute_days_until_expiry(license_obj, today)
    response.expiration_status = compute_expiration_status(license_obj, today, notification_days)
    response.document_count = len(docs)
    return response


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
    mandatory_fields = await _get_global_settings(db)

    result = await renewal_orchestrator.cancel_renewal(
        db=db,
        license_id=license_id,
        actor=_editor,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    reload_result = await db.execute(
        select(License).where(License.id == license_id).options(selectinload(License.documents))
    )
    license_obj = reload_result.scalar_one()

    return CancelRenewalResponse(
        license=_enrich(license_obj, mandatory_fields),
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
    mandatory_fields = await _get_global_settings(db)

    result = await renewal_orchestrator.initiate_renewal(
        db=db,
        license_id=license_id,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()
    await db.refresh(result.sourcing_item)

    reload_result = await db.execute(
        select(License).where(License.id == license_id).options(selectinload(License.documents))
    )
    license_obj = reload_result.scalar_one()

    return InitiateRenewalResponse(
        license=_enrich(license_obj, mandatory_fields),
        sourcing_item=SourcingItemResponse.model_validate(result.sourcing_item),
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
    mandatory_fields = await _get_global_settings(db)

    result = await renewal_orchestrator.initiate_renewal_bundle(
        db=db,
        license_ids=payload.license_ids,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    license_result = await db.execute(
        select(License)
        .where(License.id.in_([license_obj.id for license_obj in result.licenses]))
        .options(selectinload(License.documents))
    )
    licenses_by_id = {license_obj.id: license_obj for license_obj in license_result.scalars().all()}

    request_result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.id == result.sourcing_request.id)
        .options(selectinload(SourcingRequest.items), selectinload(SourcingRequest.quote_documents))
    )
    sourcing_request = request_result.scalar_one()

    return InitiateRenewalBundleResponse(
        licenses=[_enrich(licenses_by_id[license_obj.id], mandatory_fields) for license_obj in result.licenses],
        sourcing_request=SourcingRequestResponse.model_validate(sourcing_request),
    )

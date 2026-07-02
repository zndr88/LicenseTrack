from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.user import User
from app.schemas.license import LicenseResponse
from app.schemas.pending_order import (
    BatchConvertItem,
    PendingOrderConvertRequest,
)
from app.services.pending_order_conversion_service import (
    batch_convert_pending_order_to_licenses,
    convert_pending_order_to_licenses,
    retry_evidence_transfer,
)

router = APIRouter(prefix="/api/pending-orders", tags=["pending-orders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]



@router.post("/{order_id}/convert", response_model=list[LicenseResponse], status_code=200)
async def convert_pending_order_to_license(
    order_id: int,
    request: Request,
    db: DbSession,
    data: str = Form(...),
    file: Optional[UploadFile] = None,
    current_user: User = Depends(require_editor_or_admin),
) -> list[LicenseResponse]:
    """Convert a pending order to live license(s)."""
    try:
        convert_payload = PendingOrderConvertRequest.model_validate_json(data)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid license data: {exc.errors(include_url=False)}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not parse license data: {exc}",
        )

    return await convert_pending_order_to_licenses(
        order_id=order_id,
        convert_payload=convert_payload,
        file=file,
        db=db,
        current_user=current_user,
        ip_address=request.client.host if request.client else None,
    )


@router.post("/{order_id}/convert-all", response_model=list[LicenseResponse], status_code=200)
async def batch_convert_pending_order(
    order_id: int,
    payload: list[BatchConvertItem],
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> list[LicenseResponse]:
    """Convert specific sourcing items in a pending order into licenses."""
    return await batch_convert_pending_order_to_licenses(
        order_id=order_id,
        payload=payload,
        db=db,
        current_user=current_user,
        ip_address=request.client.host if request.client else None,
    )


@router.post(
    "/{order_id}/retry-evidence-transfer",
    status_code=204,
    response_class=Response,
)
async def retry_pending_order_evidence_transfer(
    order_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> Response:
    """Re-attempt the evidence (quote document) transfer for a converted order
    whose transfer previously failed or is stuck in 'pending'."""
    await retry_evidence_transfer(
        order_id=order_id,
        db=db,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
    )
    return Response(status_code=204)

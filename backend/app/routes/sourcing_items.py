from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.models.user import User
from app.schemas.sourcing import (
    CotermMergeRequest,
    SourcingItemCreate,
    SourcingItemResponse,
    SourcingItemUpdate,
)
from app.services.audit_service import diff_fields, log_event
from app.services.money import MoneyParseError
from app.services.sourcing_service import (
    create_sourcing_item_record,
    delete_sourcing_item_record,
    merge_coterm_sourcing_items_record,
    update_sourcing_item_record,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[SourcingItemResponse])
async def list_sourcing_items(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[SourcingItemResponse]:
    query = (
        select(SourcingItem)
        .outerjoin(SourcingRequest, SourcingRequest.id == SourcingItem.sourcing_request_id)
        .where(
            SourcingItem.status == SourcingStatus.sourcing,
            or_(
                SourcingItem.sourcing_request_id.is_(None),
                SourcingRequest.status == SourcingStatus.sourcing,
            ),
        )
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    query = query.options(selectinload(SourcingItem.converted_licenses))
    result = await db.execute(query)
    items = list(result.scalars().all())
    return [SourcingItemResponse.model_validate(item) for item in items]


@router.post("/merge", response_model=SourcingItemResponse, status_code=201)
async def merge_coterm_sourcing_items(
    payload: CotermMergeRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> SourcingItemResponse:
    """
    Merge two or more renewal sourcing items into a single coterm sourcing item.

    All items must be in "sourcing" status and must be renewal items
    (renewal_for_license_id set).  The merged item inherits publisher/description/
    supplier/contact from the primary predecessor's sourcing item and sums the
    quantities and independently calculated line values. All lines must use one
    currency. Mixed unit prices are represented by a blank merged unit price.
    The original items are deleted; predecessor licenses are untouched.
    """
    try:
        outcome = await merge_coterm_sourcing_items_record(
            db,
            payload.sourcing_item_ids,
            created_by=current_user.id,
        )
    except MoneyParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    merged = outcome.item

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.merged",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(merged.id),
        target_label=merged.software_description,
        detail=f"merged {len(outcome.source_item_ids)} items: {list(outcome.source_item_ids)}",
    )
    await db.commit()
    await db.refresh(merged)

    return SourcingItemResponse.model_validate(merged)


@router.get("/{item_id}", response_model=SourcingItemResponse)
async def get_sourcing_item(
    item_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingItemResponse:
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.converted_licenses))
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")
    return SourcingItemResponse.model_validate(item)


@router.post("", response_model=SourcingItemResponse, status_code=201)
async def create_sourcing_item(
    payload: SourcingItemCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> SourcingItemResponse:
    item = await create_sourcing_item_record(db, payload, created_by=current_user.id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.created",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item.id),
        target_label=item.software_description,
    )
    await db.commit()
    await db.refresh(item)
    return SourcingItemResponse.model_validate(item)


@router.put("/{item_id}", response_model=SourcingItemResponse)
async def update_sourcing_item(
    item_id: int,
    payload: SourcingItemUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingItemResponse:
    outcome = await update_sourcing_item_record(db, item_id, payload)
    item = outcome.item
    sourcing_request = outcome.request

    diff = diff_fields(
        outcome.before,
        outcome.after,
        exclude={"supplier", "contact_email"} if sourcing_request is not None else None,
    )
    if outcome.request_before is not None:
        request_diff = diff_fields(outcome.request_before, outcome.request_after)
        if request_diff:
            ip = request.client.host if request.client else None
            await log_event(
                db,
                "sourcing_request.updated",
                actor=_editor,
                ip_address=ip,
                target_type="sourcing_request",
                target_id=str(sourcing_request.id),
                target_label=sourcing_request.supplier or f"Sourcing request {sourcing_request.id}",
                detail=request_diff,
            )
    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "sourcing.updated",
            actor=_editor,
            ip_address=ip,
            target_type="sourcing",
            target_id=str(item_id),
            target_label=item.software_description,
            detail=diff,
        )

    await db.commit()
    await db.refresh(item)
    return SourcingItemResponse.model_validate(item)


@router.delete("/{item_id}", status_code=204, response_class=Response)
async def delete_sourcing_item(
    item_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    outcome = await delete_sourcing_item_record(db, item_id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item_id),
        target_label=outcome.label,
    )
    await db.commit()
    return Response(status_code=204)

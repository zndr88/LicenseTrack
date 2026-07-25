from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.license import License, LicenseType
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
    apply_sourcing_item_update,
    assert_sourcing_item_editable,
    build_merged_sourcing_item,
    delete_empty_sourcing_requests,
    ensure_sourcing_request_for_item,
    get_sourcing_request_for_update_or_404,
    handle_delete_side_effects,
    refresh_sourcing_request_status,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _norm(value: object) -> str:
    return str(value or "").strip().casefold()


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def _validate_coterm_merge_compatibility(items: list[SourcingItem], predecessors: list[License]) -> None:
    publishers = {
        *(_norm(license_obj.publisher_name) for license_obj in predecessors),
        *(_norm(item.publisher_name) for item in items),
    }
    descriptions = {
        *(_norm(license_obj.software_description) for license_obj in predecessors),
        *(_norm(item.software_description) for item in items),
    }
    metrics = {_enum_value(license_obj.license_metric) for license_obj in predecessors}
    present_skus = {_norm(license_obj.sku_code) for license_obj in predecessors if _norm(license_obj.sku_code)}

    if len(publishers) > 1:
        raise HTTPException(status_code=400, detail="Coterm merge requires the same publisher.")
    if len(descriptions) > 1:
        raise HTTPException(status_code=400, detail="Coterm merge requires the same software description.")
    if len(metrics) > 1:
        raise HTTPException(status_code=400, detail="Coterm merge requires the same license metric.")
    if len(present_skus) > 1:
        raise HTTPException(status_code=400, detail="Coterm merge requires matching SKU codes when SKUs are present.")


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
    currency/supplier/contact from the primary predecessor's sourcing item and sums
    the quantities.  The original items are deleted; predecessor licenses are untouched.
    """
    if len(payload.sourcing_item_ids) < 2:
        raise HTTPException(status_code=400, detail="At least two sourcing item IDs are required to merge")

    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id.in_(payload.sourcing_item_ids))
        .options(selectinload(SourcingItem.sourcing_request))
        .with_for_update()
    )
    items = list(result.scalars().all())

    found_ids = {item.id for item in items}
    missing = set(payload.sourcing_item_ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Sourcing item(s) not found: {sorted(missing)}")

    already_closed = [item.id for item in items if item.status != SourcingStatus.sourcing]
    if already_closed:
        raise HTTPException(
            status_code=400,
            detail=f"Sourcing item(s) are no longer open: {already_closed}",
        )

    not_renewals = [item.id for item in items if item.renewal_for_license_id is None]
    if not_renewals:
        raise HTTPException(
            status_code=400,
            detail=f"Sourcing item(s) are not renewal items: {not_renewals}",
        )

    # Load all predecessor licenses
    predecessor_license_ids = [item.renewal_for_license_id for item in items]
    pred_result = await db.execute(select(License).where(License.id.in_(predecessor_license_ids)))
    predecessors = list(pred_result.scalars().all())
    predecessor_ids = {lic.id for lic in predecessors}
    missing_predecessors = sorted(set(predecessor_license_ids) - predecessor_ids)
    if missing_predecessors:
        raise HTTPException(status_code=404, detail=f"Predecessor license(s) not found: {missing_predecessors}")
    # Validate predecessor licenses are still eligible to be renewed.
    # A sourcing item can outlive a renewal window if the license was
    # renewed, retired, or marked legacy by another path after the item
    # was created.
    ineligible = [lic.id for lic in predecessors if lic.lifecycle_status in ("renewed", "legacy") or lic.is_retired]
    if ineligible:
        raise HTTPException(
            status_code=400,
            detail=f"Predecessor license(s) are no longer eligible for renewal: {sorted(ineligible)}",
        )
    _validate_coterm_merge_compatibility(items, predecessors)
    original_request_ids = {
        item.sourcing_request_id for item in items if item.sourcing_request_id is not None
    }

    try:
        merged = build_merged_sourcing_item(items, predecessors, created_by=current_user.id)
    except MoneyParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.add(merged)
    await ensure_sourcing_request_for_item(db, merged, created_by=current_user.id)

    # Delete original sourcing items
    for item in items:
        await db.delete(item)
    await db.flush()
    await delete_empty_sourcing_requests(db, original_request_ids)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.merged",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(merged.id),
        target_label=merged.software_description,
        detail=f"merged {len(items)} items: {[i.id for i in items]}",
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
    item_data = payload.model_dump(by_alias=False)
    item_data.pop("parent_item_index", None)
    item = SourcingItem(**item_data, created_by=current_user.id)
    db.add(item)
    await db.flush()
    await ensure_sourcing_request_for_item(db, item, created_by=current_user.id)

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
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request))
        .with_for_update()
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")
    assert_sourcing_item_editable(item)

    sourcing_request = (
        await get_sourcing_request_for_update_or_404(db, item.sourcing_request_id)
        if item.sourcing_request_id is not None
        else None
    )
    before = {c.name: getattr(item, c.name) for c in item.__table__.columns}
    request_before = (
        {c.name: getattr(sourcing_request, c.name) for c in sourcing_request.__table__.columns}
        if sourcing_request is not None
        else None
    )
    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    if update_data.get("license_type", item.license_type) == LicenseType.freeware:
        update_data["estimated_unit_price"] = None
        update_data["estimated_total_price"] = None
    apply_sourcing_item_update(item, sourcing_request, update_data)
    after = {c.name: getattr(item, c.name) for c in item.__table__.columns}

    diff = diff_fields(
        before,
        after,
        exclude={"supplier", "contact_email"} if sourcing_request is not None else None,
    )
    if request_before is not None:
        request_after = {c.name: getattr(sourcing_request, c.name) for c in sourcing_request.__table__.columns}
        request_diff = diff_fields(request_before, request_after)
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
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request))
        .with_for_update()
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Sourcing item not found")
    assert_sourcing_item_editable(item)

    renewal_license_id = item.renewal_for_license_id
    parent_order_id = item.pending_order_id
    sourcing_request = item.sourcing_request
    label = item.software_description
    await db.delete(item)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="sourcing",
        target_id=str(item_id),
        target_label=label,
    )

    await handle_delete_side_effects(db, renewal_license_id=renewal_license_id, parent_order_id=parent_order_id)
    if sourcing_request is not None:
        converted_siblings = await db.scalar(
            select(func.count())
            .select_from(SourcingItem)
            .where(
                SourcingItem.sourcing_request_id == sourcing_request.id,
                SourcingItem.status == SourcingStatus.converted,
            )
        )
        if converted_siblings:
            await refresh_sourcing_request_status(db, sourcing_request)
    await db.commit()
    return Response(status_code=204)

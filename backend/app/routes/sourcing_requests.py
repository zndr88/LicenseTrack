from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.user import User
from app.schemas.sourcing import (
    SourcingItemCreate,
    SourcingRequestCreate,
    SourcingRequestResponse,
    SourcingRequestUpdate,
)
from app.services.audit_service import diff_fields, format_audit_detail, log_event
from app.services.document_availability_service import get_document_storage_base, with_file_availability
from app.services.sourcing_service import (
    add_sourcing_request_item_record,
    apply_sourcing_request_update,
    apply_sourcing_request_workflow_update,
    assert_sourcing_request_editable,
    cancel_sourcing_request_record,
    create_sourcing_request_record,
    delete_sourcing_request_record,
    get_sourcing_request_or_404,
    get_sourcing_request_for_update_or_404,
    list_sourcing_request_history_records,
    list_sourcing_request_records,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _sourcing_request_response(sourcing_request, storage_base: str | None = None) -> SourcingRequestResponse:
    response = SourcingRequestResponse.model_validate(sourcing_request)
    quote_documents = list(sourcing_request.quote_documents) if "quote_documents" in sourcing_request.__dict__ else []
    for document_response, document in zip(response.quote_documents, quote_documents, strict=False):
        with_file_availability(document_response, document, storage_base)
    return response


@router.get("/requests", response_model=list[SourcingRequestResponse])
async def list_sourcing_requests(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[SourcingRequestResponse]:
    requests = await list_sourcing_request_records(db)
    await db.commit()
    storage_base = await get_document_storage_base(db)
    return [_sourcing_request_response(request, storage_base) for request in requests]


@router.get("/requests/history", response_model=list[SourcingRequestResponse])
async def list_sourcing_request_history(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[SourcingRequestResponse]:
    requests = await list_sourcing_request_history_records(db)
    await db.commit()
    storage_base = await get_document_storage_base(db)
    return [_sourcing_request_response(request, storage_base) for request in requests]


@router.post("/requests", response_model=SourcingRequestResponse, status_code=201)
async def create_sourcing_request(
    payload: SourcingRequestCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await create_sourcing_request_record(db, payload, created_by=current_user.id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_request.created",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(sourcing_request.id),
        target_label=sourcing_request.supplier or f"Sourcing request {sourcing_request.id}",
    )
    await db.commit()
    sourcing_request = await get_sourcing_request_or_404(db, sourcing_request.id)
    storage_base = await get_document_storage_base(db)
    return _sourcing_request_response(sourcing_request, storage_base)


@router.get("/requests/{request_id}", response_model=SourcingRequestResponse)
async def get_sourcing_request(
    request_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    storage_base = await get_document_storage_base(db)
    return _sourcing_request_response(sourcing_request, storage_base)


@router.put("/requests/{request_id}", response_model=SourcingRequestResponse)
async def update_sourcing_request(
    request_id: int,
    payload: SourcingRequestUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await get_sourcing_request_for_update_or_404(db, request_id)
    assert_sourcing_request_editable(sourcing_request)
    before = {c.name: getattr(sourcing_request, c.name) for c in sourcing_request.__table__.columns}
    item_before = {
        item.id: {c.name: getattr(item, c.name) for c in item.__table__.columns}
        for item in sourcing_request.items
    }
    if payload.items is None:
        update_data = payload.model_dump(by_alias=False, exclude_unset=True)
        await apply_sourcing_request_update(db, sourcing_request, update_data)
        updated_item_ids: list[int] = []
    else:
        updated_item_ids = await apply_sourcing_request_workflow_update(db, sourcing_request, payload)
    updated_items = [item for item in sourcing_request.items if item.id in updated_item_ids]
    await db.flush()
    await db.refresh(sourcing_request)
    for item in updated_items:
        await db.refresh(item)
    after = {c.name: getattr(sourcing_request, c.name) for c in sourcing_request.__table__.columns}

    request_diff = diff_fields(before, after)
    item_diffs = []
    for item in updated_items:
        item_after = {c.name: getattr(item, c.name) for c in item.__table__.columns}
        item_diff = diff_fields(item_before[item.id], item_after, exclude={"supplier", "contact_email"})
        if item_diff:
            item_diffs.extend(f"item[{item.id}].{line}" for line in item_diff.splitlines())
    if request_diff or item_diffs:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "sourcing_request.updated",
            actor=_editor,
            ip_address=ip,
            target_type="sourcing_request",
            target_id=str(request_id),
            target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
            detail=format_audit_detail(
                "sourcing_request_edit",
                {"updatedItemIds": ",".join(str(item_id) for item_id in updated_item_ids) or None},
                [*(request_diff.splitlines() if request_diff else []), *item_diffs],
            ),
        )
    await db.commit()
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    storage_base = await get_document_storage_base(db)
    return _sourcing_request_response(sourcing_request, storage_base)


@router.post("/requests/{request_id}/cancel", response_model=SourcingRequestResponse)
async def cancel_sourcing_request(
    request_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await cancel_sourcing_request_record(db, request_id)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_request.cancelled",
        actor=_editor,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
    )
    await db.commit()
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    storage_base = await get_document_storage_base(db)
    return _sourcing_request_response(sourcing_request, storage_base)


@router.delete("/requests/{request_id}", status_code=204, response_class=Response)
async def delete_sourcing_request(
    request_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    label = await delete_sourcing_request_record(db, request_id)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_request.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=label,
    )
    await db.commit()
    return Response(status_code=204)


@router.post("/requests/{request_id}/items", response_model=SourcingRequestResponse, status_code=201)
async def add_sourcing_request_item(
    request_id: int,
    payload: SourcingItemCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await add_sourcing_request_item_record(
        db,
        request_id,
        payload,
        created_by=current_user.id,
    )
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_request.item_added",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
        detail=f"{payload.publisher_name} - {payload.software_description}",
    )
    await db.commit()
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    storage_base = await get_document_storage_base(db)
    return _sourcing_request_response(sourcing_request, storage_base)

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
from app.services.audit_service import diff_fields, log_event
from app.services.sourcing_service import (
    add_sourcing_request_item_record,
    apply_sourcing_request_update,
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


@router.get("/requests", response_model=list[SourcingRequestResponse])
async def list_sourcing_requests(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[SourcingRequestResponse]:
    requests = await list_sourcing_request_records(db)
    await db.commit()
    return [SourcingRequestResponse.model_validate(request) for request in requests]


@router.get("/requests/history", response_model=list[SourcingRequestResponse])
async def list_sourcing_request_history(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[SourcingRequestResponse]:
    requests = await list_sourcing_request_history_records(db)
    await db.commit()
    return [SourcingRequestResponse.model_validate(request) for request in requests]


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
    return SourcingRequestResponse.model_validate(sourcing_request)


@router.get("/requests/{request_id}", response_model=SourcingRequestResponse)
async def get_sourcing_request(
    request_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> SourcingRequestResponse:
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    return SourcingRequestResponse.model_validate(sourcing_request)


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
    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    apply_sourcing_request_update(sourcing_request, update_data)
    after = {c.name: getattr(sourcing_request, c.name) for c in sourcing_request.__table__.columns}

    diff = diff_fields(before, after)
    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "sourcing_request.updated",
            actor=_editor,
            ip_address=ip,
            target_type="sourcing_request",
            target_id=str(request_id),
            target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
            detail=diff,
        )
    await db.commit()
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    return SourcingRequestResponse.model_validate(sourcing_request)


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
    return SourcingRequestResponse.model_validate(sourcing_request)


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
    return SourcingRequestResponse.model_validate(sourcing_request)

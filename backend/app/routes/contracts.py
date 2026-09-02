"""
Contracts routes.

GET    /api/contracts                          - list all contracts
GET    /api/contracts/{contract_id}            - single contract
POST   /api/contracts                          - create contract
PUT    /api/contracts/{contract_id}            - update contract
DELETE /api/contracts/{contract_id}            - delete contract + files
GET    /api/contracts/{contract_id}/licenses   - licenses linked by contract_number
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.contract import Contract, ContractDocument
from app.models.license import License
from app.models.settings import GlobalSettings
from app.models.user import User
from app.schemas.contract import (
    ContractCreate,
    ContractResponse,
    ContractUpdate,
    LinkedLicenseResponse,
)
from app.services import storage
from app.services.access_service import (
    apply_department_filter,
    can_view_contract,
    get_user_departments_for_scope,
    get_viewer_departments,
)
from app.services.audit_service import diff_fields, log_event
from app.services.contract_response_service import build_contract_response
from app.services.contract_storage_service import get_storage_base
from app.services.contract_identity_service import (
    assert_contract_number_unambiguous,
    assert_unique_contract_number,
    contract_number_is_unambiguous,
    license_contract_match,
)
from app.services.reference_data_service import resolve_contract_publisher
from app.services.license_service import compute_expiration_status

router = APIRouter(tags=["contracts"])
logger = logging.getLogger(__name__)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _get_notification_days(db: AsyncSession) -> int:
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = gs_result.scalar_one_or_none()
    if gs and gs.notification_days and 1 <= gs.notification_days <= 365:
        return gs.notification_days
    return 30


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get("/api/contracts", response_model=list[ContractResponse])
async def list_contracts(
    db: DbSession,
    _current_user: CurrentUser,
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[ContractResponse]:
    query = select(Contract).options(selectinload(Contract.folders)).order_by(Contract.publisher_name.asc())

    if _current_user.role == "viewer":
        departments = await get_viewer_departments(_current_user.id, db)
        if not departments:
            return []
        visible_contract_ids = (
            select(License.contract_id)
            .where(License.contract_id.isnot(None))
            .where(License.cost_centre_id.in_(departments))
            .distinct()
        )
        visible_legacy_numbers = (
            select(func.lower(func.trim(License.contract_number)))
            .where(License.contract_id.is_(None))
            .where(License.contract_number.isnot(None))
            .where(License.cost_centre_id.in_(departments))
            .distinct()
        )
        query = query.where(
            (Contract.id.in_(visible_contract_ids))
            | (
                (func.lower(func.trim(Contract.contract_number)).in_(visible_legacy_numbers))
                & contract_number_is_unambiguous(Contract)
            )
        )

    if _current_user.role == "viewer":
        # A contract is shared evidence: filter the complete result set before
        # pagination so a page cannot leak a contract with another department.
        result = await db.execute(query)
        visible_contracts = [
            contract
            for contract in result.scalars().all()
            if await can_view_contract(_current_user, contract, db)
        ]
        contracts = visible_contracts[offset : offset + limit if limit is not None else None]
        departments = await get_user_departments_for_scope(_current_user, db)
        return [await build_contract_response(c, db, departments) for c in contracts]

    query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    contracts = result.scalars().all()
    departments = await get_user_departments_for_scope(_current_user, db)
    return [await build_contract_response(c, db, departments) for c in contracts]


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------


@router.get("/api/contracts/{contract_id}", response_model=ContractResponse)
async def get_contract(
    contract_id: int,
    db: DbSession,
    _current_user: CurrentUser,
) -> ContractResponse:
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).options(selectinload(Contract.folders))
    )
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    if not await can_view_contract(_current_user, contract, db):
        raise HTTPException(status_code=404, detail="Contract not found")
    departments = await get_user_departments_for_scope(_current_user, db)
    return await build_contract_response(contract, db, departments)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


@router.post("/api/contracts", response_model=ContractResponse, status_code=201)
async def create_contract(
    body: ContractCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> ContractResponse:
    contract_number = body.contract_number.strip()
    await assert_unique_contract_number(db, contract_number)
    publisher = await resolve_contract_publisher(db, body.publisher_name)
    contract = Contract(
        contract_number=contract_number,
        publisher_name=publisher.name,
        publisher_id=publisher.id,
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(contract)
    await db.flush()

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "contract.created",
        actor=current_user,
        ip_address=ip,
        target_type="contract",
        target_id=str(contract.id),
        target_label=contract.contract_number,
    )
    await db.commit()
    await db.refresh(contract)
    result = await db.execute(
        select(Contract).where(Contract.id == contract.id).options(selectinload(Contract.folders))
    )
    contract = result.scalar_one()
    return await build_contract_response(contract, db)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


@router.put("/api/contracts/{contract_id}", response_model=ContractResponse)
async def update_contract(
    contract_id: int,
    body: ContractUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> ContractResponse:
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).options(selectinload(Contract.folders))
    )
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")

    before = {c.name: getattr(contract, c.name) for c in contract.__table__.columns}

    if body.contract_number is not None:
        new_contract_number = body.contract_number.strip()
        if contract.contract_number != new_contract_number:
            await assert_contract_number_unambiguous(
                db,
                contract.contract_number,
                current_contract_id=contract.id,
            )
        await assert_unique_contract_number(
            db,
            new_contract_number,
            exclude_contract_id=contract.id,
        )
        contract.contract_number = new_contract_number
    if body.publisher_name is not None:
        publisher = await resolve_contract_publisher(db, body.publisher_name)
        contract.publisher_name = publisher.name
        contract.publisher_id = publisher.id
    if "notes" in body.model_fields_set:
        contract.notes = body.notes

    after = {c.name: getattr(contract, c.name) for c in contract.__table__.columns}
    diff = diff_fields(before, after, exclude={"id", "created_at", "updated_at"})

    old_contract_number = before["contract_number"]
    new_contract_number = contract.contract_number
    if old_contract_number != new_contract_number:
        await db.execute(
            sa_update(License)
            .where(License.contract_id == contract.id)
            .values(contract_number=new_contract_number)
        )

    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "contract.updated",
            actor=_editor,
            ip_address=ip,
            target_type="contract",
            target_id=str(contract_id),
            target_label=contract.contract_number,
            detail=diff,
        )

    await db.commit()
    await db.refresh(contract)
    result = await db.execute(
        select(Contract).where(Contract.id == contract.id).options(selectinload(Contract.folders))
    )
    contract = result.scalar_one()
    return await build_contract_response(contract, db)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


@router.delete("/api/contracts/{contract_id}", status_code=204, response_class=Response)
async def delete_contract(
    contract_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).options(selectinload(Contract.folders))
    )
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")

    label = contract.contract_number

    docs_result = await db.execute(select(ContractDocument).where(ContractDocument.contract_id == contract_id))
    docs = docs_result.scalars().all()
    stored_paths = [doc.filename for doc in docs]

    await db.execute(sa_update(License).where(License.contract_id == contract_id).values(contract_id=None))
    await db.delete(contract)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "contract.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="contract",
        target_label=label,
    )
    await db.commit()

    if stored_paths:
        storage_base = await get_storage_base(db)
        for path in stored_paths:
            try:
                storage.delete_file(path, storage_base)
            except Exception:
                logger.warning("Could not delete stored contract file %s", path, exc_info=True)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Linked licenses
# ---------------------------------------------------------------------------


@router.get(
    "/api/contracts/{contract_id}/licenses",
    response_model=list[LinkedLicenseResponse],
)
async def get_contract_licenses(
    contract_id: int,
    db: DbSession,
    _current_user: CurrentUser,
) -> list[LinkedLicenseResponse]:
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    if not await can_view_contract(_current_user, contract, db):
        raise HTTPException(status_code=404, detail="Contract not found")

    license_query = select(License).where(
        license_contract_match(contract),
        License.is_retired.is_(False),
    ).options(selectinload(License.renewed_to))
    departments = await get_user_departments_for_scope(_current_user, db)
    license_query = apply_department_filter(license_query, departments)
    lics_result = await db.execute(license_query)
    licenses = lics_result.scalars().all()

    notification_days = await _get_notification_days(db)
    today = date.today()
    responses: list[LinkedLicenseResponse] = []
    for lic in licenses:
        expiration_status = compute_expiration_status(
            lic,
            today,
            notification_days,
            successor_start_date=lic.renewed_to.start_date if lic.renewed_to else None,
        )
        responses.append(
            LinkedLicenseResponse(
                id=lic.id,
                publisher_name=lic.publisher_name,
                software_description=lic.software_description,
                contract_number=lic.contract_number,
                start_date=lic.start_date.isoformat() if lic.start_date else None,
                end_date=lic.end_date.isoformat() if lic.end_date else None,
                lifecycle_status=lic.lifecycle_status,
                expiration_status=expiration_status,
            )
        )

    return responses

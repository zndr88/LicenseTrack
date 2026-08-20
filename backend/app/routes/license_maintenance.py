from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.license import License, LicenseCoverageHistory
from app.services.maintenance_rules import MAINTENANCE_PARENT_TYPES
from app.models.user import User
from app.schemas.license import LicenseCoverageHistoryResponse, LicenseResponse, MaintenanceLinkExistingRequest
from app.services.audit_service import log_event
from app.services.license_service import (
    calc_line_total,
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.maintenance_service import activate_maintenance_for_parent, disable_maintenance_for_parent
from app.services.settings_service import get_global_settings as _get_cached_global_settings

router = APIRouter(prefix="/api/licenses", tags=["license-maintenance"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_DEFAULT_NOTIFICATION_DAYS = 30


@router.get("/{license_id}/coverage-history", response_model=list[LicenseCoverageHistoryResponse])
async def get_coverage_history(license_id: int, db: DbSession) -> list[LicenseCoverageHistoryResponse]:
    """Return preserved coverage periods and the currently active period."""
    parent_result = await db.execute(select(License).where(License.id == license_id))
    parent = parent_result.scalar_one_or_none()
    if parent is None:
        raise HTTPException(status_code=404, detail="License not found")

    result = await db.execute(
        select(LicenseCoverageHistory, License.license_ref, License.software_description)
        .join(License, License.id == LicenseCoverageHistory.maintenance_license_id, isouter=True)
        .where(LicenseCoverageHistory.parent_license_id == license_id)
        .order_by(LicenseCoverageHistory.start_date, LicenseCoverageHistory.id)
    )
    rows = [
        LicenseCoverageHistoryResponse.model_validate(row[0]).model_copy(
            update={"license_ref": row[1], "software_description": row[2]}
        )
        for row in result.all()
    ]

    if parent.active_maintenance_id is not None:
        active_result = await db.execute(select(License).where(License.id == parent.active_maintenance_id))
        active = active_result.scalar_one_or_none()
        if active is not None:
            line_total = calc_line_total(active.quantity, active.unit_price)
            rows.append(
                LicenseCoverageHistoryResponse(
                    id=-(active.id),
                    parent_license_id=parent.id,
                    maintenance_license_id=active.id,
                    coverage_type="separately_tracked",
                    source_type="current_maintenance_record",
                    start_date=active.start_date,
                    end_date=active.end_date,
                    quantity=active.quantity,
                    unit_price=active.unit_price,
                    cost=format(line_total, "f") if line_total is not None else None,
                    currency=active.currency,
                    created_at=active.created_at,
                    is_current=True,
                    license_ref=active.license_ref,
                    software_description=active.software_description,
                )
            )
    return rows


async def _get_global_settings(db: AsyncSession) -> tuple[dict, int]:
    gs = await _get_cached_global_settings(db)
    if gs is None:
        return {}, _DEFAULT_NOTIFICATION_DAYS
    return (gs.mandatory_fields or {}, int(gs.notification_days))


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
    parent_links = license_obj.__dict__.get("maintenance_parent_links")
    if parent_links is not None:
        response.maintenance_parent_ids = sorted({link.parent_license_id for link in parent_links})
    elif response.parent_license_id is not None:
        response.maintenance_parent_ids = [response.parent_license_id]
    child_links = license_obj.__dict__.get("maintenance_child_links")
    if child_links is not None:
        linked_ids = sorted({link.maintenance_license_id for link in child_links})
        response.linked_maintenance_ids = linked_ids
        if not linked_ids and response.active_maintenance_id is not None:
            response.linked_maintenance_ids = [response.active_maintenance_id]
    elif response.active_maintenance_id is not None:
        response.linked_maintenance_ids = [response.active_maintenance_id]
    return response


def _license_with_maintenance_options():
    return (
        selectinload(License.documents),
        selectinload(License.maintenance_parent_links),
        selectinload(License.maintenance_child_links),
    )


@router.post("/{license_id}/disable-maintenance", response_model=LicenseResponse)
async def disable_maintenance(
    license_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    """Disable linked maintenance/support tracking on an eligible parent License."""
    mandatory_fields, notification_days = await _get_global_settings(db)

    result = await db.execute(select(License).where(License.id == license_id).options(*_license_with_maintenance_options()))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")

    if license_obj.license_type not in MAINTENANCE_PARENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=("Maintenance/support tracking can only be disabled on perpetual, OEM, or freeware Licenses."),
        )

    if not license_obj.has_maintenance:
        return _enrich(license_obj, mandatory_fields, notification_days)

    await disable_maintenance_for_parent(db, license_obj)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "license.maintenance_disabled",
        actor=current_user,
        ip_address=ip,
        target_type="license",
        target_id=str(license_id),
        target_label=license_obj.software_description,
    )
    await db.commit()

    reload_result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(*_license_with_maintenance_options())
        .execution_options(populate_existing=True)
    )
    license_obj = reload_result.scalar_one()
    return _enrich(license_obj, mandatory_fields, notification_days)


@router.post("/{license_id}/link-maintenance", response_model=LicenseResponse)
async def link_existing_maintenance(
    license_id: int,
    payload: MaintenanceLinkExistingRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    """Link an existing maintenance/support License to an eligible parent License."""
    mandatory_fields, notification_days = await _get_global_settings(db)

    parent_result = await db.execute(
        select(License).where(License.id == license_id).options(*_license_with_maintenance_options())
    )
    parent = parent_result.scalar_one_or_none()
    if parent is None:
        raise HTTPException(status_code=404, detail="License not found")
    if parent.license_type not in MAINTENANCE_PARENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=("Maintenance/support tracking can only be linked to perpetual, OEM, or freeware Licenses."),
        )

    maintenance_result = await db.execute(
        select(License).where(License.id == payload.maintenance_license_id)
    )
    maintenance = maintenance_result.scalar_one_or_none()
    if maintenance is None:
        raise HTTPException(status_code=404, detail="Maintenance license not found")

    try:
        await activate_maintenance_for_parent(db, maintenance, parent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "license.maintenance_linked",
        actor=current_user,
        ip_address=ip,
        target_type="license",
        target_id=str(license_id),
        target_label=parent.software_description,
        detail=f"maintenanceLicenseId={maintenance.id}",
    )
    await db.commit()

    reload_result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(*_license_with_maintenance_options())
        .execution_options(populate_existing=True)
    )
    parent = reload_result.scalar_one()
    return _enrich(parent, mandatory_fields, notification_days)

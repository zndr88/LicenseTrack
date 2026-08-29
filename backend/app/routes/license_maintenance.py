from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.license import License, LicenseCoverageHistory
from app.services.maintenance_rules import MAINTENANCE_PARENT_TYPES
from app.models.user import User
from app.schemas.license import LicenseCoverageHistoryResponse, LicenseResponse, MaintenanceLinkExistingRequest
from app.services.audit_service import log_event
from app.services.access_service import can_view_license
from app.services.license_response_service import load_enriched_license_response
from app.services.license_service import calc_line_total
from app.services.maintenance_service import activate_maintenance_for_parent, disable_maintenance_for_parent

router = APIRouter(prefix="/api/licenses", tags=["license-maintenance"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

@router.get("/{license_id}/coverage-history", response_model=list[LicenseCoverageHistoryResponse])
async def get_coverage_history(
    license_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[LicenseCoverageHistoryResponse]:
    """Return preserved coverage periods and the currently active period."""
    parent_result = await db.execute(select(License).where(License.id == license_id))
    parent = parent_result.scalar_one_or_none()
    if parent is None or not await can_view_license(current_user, parent, db):
        raise HTTPException(status_code=404, detail="License not found")

    result = await db.execute(
        select(LicenseCoverageHistory, License)
        .join(License, License.id == LicenseCoverageHistory.maintenance_license_id, isouter=True)
        .where(LicenseCoverageHistory.parent_license_id == license_id)
        .order_by(LicenseCoverageHistory.start_date, LicenseCoverageHistory.id)
    )
    rows = []
    for history, maintenance in result.all():
        response = LicenseCoverageHistoryResponse.model_validate(history)
        if maintenance is not None and await can_view_license(current_user, maintenance, db):
            response = response.model_copy(
                update={
                    "license_ref": maintenance.license_ref,
                    "software_description": maintenance.software_description,
                }
            )
        elif maintenance is not None:
            continue
        rows.append(response)

    if parent.active_maintenance_id is not None:
        active_result = await db.execute(select(License).where(License.id == parent.active_maintenance_id))
        active = active_result.scalar_one_or_none()
        if active is not None:
            can_view_active = await can_view_license(current_user, active, db)
            if not can_view_active:
                return rows
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
        return await load_enriched_license_response(db, license_id, populate_existing=True)

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

    return await load_enriched_license_response(db, license_id, populate_existing=True)


@router.post("/{license_id}/link-maintenance", response_model=LicenseResponse)
async def link_existing_maintenance(
    license_id: int,
    payload: MaintenanceLinkExistingRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    """Link an existing maintenance/support License to an eligible parent License."""
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

    was_legacy_unlinked = bool(
        maintenance.is_legacy_unlinked_maintenance
        and maintenance.parent_license_id is None
    )
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
        detail=(
            f"maintenanceLicenseId={maintenance.id}"
            + (";legacyUnlinkedMaintenance=true" if was_legacy_unlinked else "")
        ),
    )
    await db.commit()

    return await load_enriched_license_response(db, license_id, populate_existing=True)

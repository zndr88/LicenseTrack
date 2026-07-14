from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.license import License
from app.services.maintenance_rules import MAINTENANCE_PARENT_TYPES
from app.models.user import User
from app.schemas.license import LicenseResponse
from app.services.audit_service import log_event
from app.services.license_service import (
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.maintenance_service import disable_maintenance_for_parent
from app.services.settings_service import get_global_settings as _get_cached_global_settings

router = APIRouter(prefix="/api/licenses", tags=["license-maintenance"])

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


@router.post("/{license_id}/disable-maintenance", response_model=LicenseResponse)
async def disable_maintenance(
    license_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    """Disable linked maintenance/support tracking on an eligible parent License."""
    mandatory_fields = await _get_global_settings(db)

    result = await db.execute(select(License).where(License.id == license_id).options(selectinload(License.documents)))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")

    if license_obj.license_type not in MAINTENANCE_PARENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=("Maintenance/support tracking can only be disabled on perpetual, OEM, or freeware Licenses."),
        )

    if not license_obj.has_maintenance:
        return _enrich(license_obj, mandatory_fields)

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
        select(License).where(License.id == license_id).options(selectinload(License.documents))
    )
    license_obj = reload_result.scalar_one()
    return _enrich(license_obj, mandatory_fields)

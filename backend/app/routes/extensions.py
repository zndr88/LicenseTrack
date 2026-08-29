from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.extension import ExtensionCapability
from app.models.user import User
from app.schemas.extension import ExtensionCapabilityResponse, ExtensionCapabilityUpsert
from app.services.audit_service import log_event

router = APIRouter(prefix="/api/extensions", tags=["extensions"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/capabilities", response_model=list[ExtensionCapabilityResponse])
async def list_extension_capabilities(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[ExtensionCapabilityResponse]:
    result = await db.execute(
        select(ExtensionCapability).order_by(
            ExtensionCapability.capability_type.asc(),
            ExtensionCapability.name.asc(),
            ExtensionCapability.id.asc(),
        )
    )
    return [ExtensionCapabilityResponse.model_validate(capability) for capability in result.scalars().all()]


@router.put("/capabilities/{capability_key}", response_model=ExtensionCapabilityResponse)
async def upsert_extension_capability(
    capability_key: str,
    payload: ExtensionCapabilityUpsert,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> ExtensionCapabilityResponse:
    key = capability_key.strip()
    if not key:
        raise HTTPException(status_code=422, detail="Capability key is required")

    now = datetime.now(timezone.utc)
    capability = await db.scalar(select(ExtensionCapability).where(ExtensionCapability.key == key))
    action = "extension_capability.updated"
    if capability is None:
        capability = ExtensionCapability(
            key=key,
            created_by=admin.id,
        )
        db.add(capability)
        action = "extension_capability.created"

    capability.name = payload.name.strip()
    capability.capability_type = payload.capability_type
    capability.status = payload.status
    capability.version = payload.version.strip() if payload.version else None
    capability.description = payload.description.strip() if payload.description else None
    capability.health_url = payload.health_url.strip() if payload.health_url else None
    capability.last_error = payload.last_error.strip() if payload.last_error else None
    capability.details = payload.details
    capability.updated_by = admin.id
    capability.updated_at = now
    capability.last_seen_at = now

    await db.flush()
    await log_event(
        db,
        action,
        actor=admin,
        ip_address=request.client.host if request.client else None,
        target_type="extension_capability",
        target_id=str(capability.id),
        target_label=capability.key,
        detail=f"type={capability.capability_type}\nstatus={capability.status}",
    )
    await db.commit()
    await db.refresh(capability)
    return ExtensionCapabilityResponse.model_validate(capability)


@router.delete("/capabilities/{capability_key}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_extension_capability(
    capability_key: str,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> Response:
    capability = await db.scalar(select(ExtensionCapability).where(ExtensionCapability.key == capability_key))
    if capability is None:
        raise HTTPException(status_code=404, detail="Extension capability not found")

    await log_event(
        db,
        "extension_capability.deleted",
        actor=admin,
        ip_address=request.client.host if request.client else None,
        target_type="extension_capability",
        target_id=str(capability.id),
        target_label=capability.key,
    )
    await db.delete(capability)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

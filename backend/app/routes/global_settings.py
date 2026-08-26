from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.dependencies import CurrentUser, require_admin
from app.models.settings import GlobalSettings
from app.models.user import User
from app.routes.settings_helpers import DbSession, get_or_create_global_settings
from app.schemas.settings import (
    GlobalSettingsPublicResponse,
    GlobalSettingsResponse,
    GlobalSettingsUpdate,
)
from app.services.audit_service import diff_fields, log_event
from app.services.oidc_service import get_oidc_availability, invalidate_oidc_cache, normalize_oidc_issuer
from app.services.settings_service import invalidate_global_settings_cache
from app.services.settings_update_service import (
    encrypt_settings_secrets,
    normalize_smtp_encryption,
    oidc_cache_should_invalidate,
    preserve_masked_or_empty_secrets,
    validate_storage_path,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/global/public", response_model=GlobalSettingsPublicResponse)
async def get_global_settings_public(
    db: DbSession,
    current_user: CurrentUser,
) -> GlobalSettingsPublicResponse:
    global_settings = await get_or_create_global_settings(db)
    response = GlobalSettingsPublicResponse.model_validate(global_settings)
    response.oidc_available = await get_oidc_availability(global_settings) if response.oidc_enabled else False
    return response


@router.get("/global", response_model=GlobalSettingsResponse)
async def get_global_settings(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> GlobalSettingsResponse:
    global_settings = await get_or_create_global_settings(db)
    response = GlobalSettingsResponse.model_validate(global_settings)
    response.oidc_available = await get_oidc_availability(global_settings) if response.oidc_enabled else False
    return response


@router.put("/global", response_model=GlobalSettingsResponse)
async def update_global_settings(
    payload: GlobalSettingsUpdate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> GlobalSettingsResponse:
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    global_settings = result.scalar_one_or_none()
    if global_settings is None:
        global_settings = GlobalSettings(id=1)
        db.add(global_settings)
        await db.flush()

    before = {c.name: getattr(global_settings, c.name) for c in global_settings.__table__.columns}

    update_data = payload.model_dump(exclude_unset=True)
    if update_data.get("oidc_discovery_url"):
        try:
            update_data["oidc_discovery_url"] = normalize_oidc_issuer(update_data["oidc_discovery_url"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    normalize_smtp_encryption(update_data)
    validate_storage_path(update_data)
    preserve_masked_or_empty_secrets(update_data)
    encrypt_settings_secrets(update_data)

    for field, value in update_data.items():
        setattr(global_settings, field, value)

    if "mandatory_fields" in update_data:
        flag_modified(global_settings, "mandatory_fields")

    after = {c.name: getattr(global_settings, c.name) for c in global_settings.__table__.columns}
    diff = diff_fields(before, after, {"smtp_password", "oidc_client_secret"})
    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "settings.updated",
            actor=_admin,
            ip_address=ip,
            target_type="settings",
            detail=diff,
        )

    if oidc_cache_should_invalidate(update_data):
        invalidate_oidc_cache()

    await db.commit()
    await db.refresh(global_settings)
    invalidate_global_settings_cache()
    response = GlobalSettingsResponse.model_validate(global_settings)
    response.oidc_available = await get_oidc_availability(global_settings) if response.oidc_enabled else False
    return response

from fastapi import APIRouter

from app.dependencies import CurrentUser
from app.routes.settings_helpers import DbSession, get_or_create_user_settings
from app.schemas.settings import UserSettingsResponse, UserSettingsUpdate
from app.services.audit_service import diff_fields, log_event

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=UserSettingsResponse)
async def get_user_settings(db: DbSession, current_user: CurrentUser) -> UserSettingsResponse:
    user_settings = await get_or_create_user_settings(db, current_user.id)
    return UserSettingsResponse.model_validate(user_settings)


@router.put("", response_model=UserSettingsResponse)
async def update_user_settings(
    payload: UserSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> UserSettingsResponse:
    user_settings = await get_or_create_user_settings(db, current_user.id)

    before = {c.name: getattr(user_settings, c.name) for c in user_settings.__table__.columns}

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user_settings, field, value)

    after = {c.name: getattr(user_settings, c.name) for c in user_settings.__table__.columns}
    diff = diff_fields(before, after)
    if diff:
        await log_event(
            db,
            "user_settings.updated",
            actor=current_user,
            target_type="user_settings",
            target_id=str(current_user.id),
            target_label=current_user.email,
            detail=diff,
        )

    await db.commit()
    await db.refresh(user_settings)
    return UserSettingsResponse.model_validate(user_settings)

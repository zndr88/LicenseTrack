from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.settings import GlobalSettings, UserSettings
from app.services.settings_service import (
    get_global_settings as _get_cached_global_settings,
    invalidate_global_settings_cache,
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_or_create_user_settings(db: AsyncSession, user_id: int) -> UserSettings:
    settings_result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    user_settings = settings_result.scalar_one_or_none()

    if user_settings is None:
        user_settings = UserSettings(user_id=user_id)
        db.add(user_settings)
        await db.commit()
        await db.refresh(user_settings)

    return user_settings


async def get_or_create_global_settings(db: AsyncSession) -> GlobalSettings:
    global_settings = await _get_cached_global_settings(db)

    if global_settings is None:
        global_settings = GlobalSettings(id=1)
        db.add(global_settings)
        await db.commit()
        await db.refresh(global_settings)
        invalidate_global_settings_cache()

    return global_settings

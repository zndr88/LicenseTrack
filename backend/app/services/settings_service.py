import time

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.settings import GlobalSettings

_TTL_SECONDS = 60

# (GlobalSettings object, expires_at timestamp)
_cache: tuple[GlobalSettings, float] | None = None


def invalidate_global_settings_cache() -> None:
    global _cache
    _cache = None


async def get_global_settings(db: AsyncSession) -> GlobalSettings | None:
    """Return the singleton GlobalSettings row (id=1), served from a 60-second cache."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now < _cache[1]:
        return _cache[0]
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = result.scalar_one_or_none()
    if gs is not None:
        _cache = (gs, now + _TTL_SECONDS)
    return gs

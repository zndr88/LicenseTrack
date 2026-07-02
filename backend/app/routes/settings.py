"""Compatibility router for settings endpoints.

New code should import the responsibility-specific route modules directly.
"""

from fastapi import APIRouter

from app.routes import global_settings, integrations, user_settings
from app.schemas.settings import _SMTP_PASSWORD_MASK

router = APIRouter()
router.include_router(user_settings.router)
router.include_router(global_settings.router)
router.include_router(integrations.router)

__all__ = ["_SMTP_PASSWORD_MASK", "router"]

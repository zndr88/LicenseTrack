from fastapi import APIRouter

from app.routes import (
    sourcing_conversion,
    sourcing_documents,
    sourcing_exports,
    sourcing_items,
    sourcing_requests,
)

router = APIRouter()
router.include_router(sourcing_exports.router)
router.include_router(sourcing_requests.router)
router.include_router(sourcing_documents.router)
router.include_router(sourcing_items.router)
router.include_router(sourcing_conversion.router)

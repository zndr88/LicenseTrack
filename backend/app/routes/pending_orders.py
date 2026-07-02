from fastapi import APIRouter

from app.routes import (
    pending_order_conversion,
    pending_order_core,
    pending_order_documents,
    pending_order_exports,
    pending_order_items,
)

router = APIRouter()
router.include_router(pending_order_exports.router)
router.include_router(pending_order_core.router)
router.include_router(pending_order_documents.router)
router.include_router(pending_order_items.router)
router.include_router(pending_order_conversion.router)

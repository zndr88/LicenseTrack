from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.services.pending_order_export_service import build_pending_orders_export_csv

router = APIRouter(prefix="/api/pending-orders", tags=["pending-orders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]



@router.get("/export")
async def export_pending_orders(
    db: DbSession,
    _current_user: CurrentUser,
) -> StreamingResponse:
    """Download all non-converted pending orders as a CSV file."""
    csv_content = await build_pending_orders_export_csv(db)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={
            "Content-Disposition":
                "attachment; filename=pending_orders_export.csv"
        },
    )

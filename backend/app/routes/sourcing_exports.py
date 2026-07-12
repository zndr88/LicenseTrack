from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.user import User
from app.services.sourcing_export_service import build_sourcing_export_csv

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/export")
async def export_sourcing_items(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> StreamingResponse:
    """Download all active sourcing items as a CSV file."""
    csv_content = await build_sourcing_export_csv(db)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sourcing_export.csv"},
    )

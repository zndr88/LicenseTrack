from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.schemas.renewal import RenewalWorkbenchRow
from app.services.renewal_service import get_renewal_workbench_rows
from app.services.renewal_workbench_model import ALLOWED_WORKBENCH_VIEWS


router = APIRouter(prefix="/api/renewals", tags=["renewals"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/workbench", response_model=list[RenewalWorkbenchRow])
async def get_renewal_workbench(
    db: DbSession,
    current_user: CurrentUser,
    window_days: int = Query(default=90, ge=0, le=3650),
    view: str = Query(default="all"),
) -> list[RenewalWorkbenchRow]:
    if view not in ALLOWED_WORKBENCH_VIEWS:
        raise HTTPException(status_code=422, detail=f"Unsupported workbench view: {view}")
    return await get_renewal_workbench_rows(
        db=db,
        current_user=current_user,
        window_days=window_days,
        view=view,
    )

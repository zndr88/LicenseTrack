"""Admin-only operational maintenance endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User
from app.services.portfolio_reset_service import (
    PORTFOLIO_RESET_CONFIRMATION,
    portfolio_counts,
    reset_portfolio,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/operations", tags=["operations"])
DbSession = Annotated[AsyncSession, Depends(get_db)]


class PortfolioResetRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=100)


@router.get("/portfolio-reset/preview")
async def preview_portfolio_reset(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> dict:
    return {
        "counts": await portfolio_counts(db),
        "confirmation": PORTFOLIO_RESET_CONFIRMATION,
        "next_license_ref": "LT-REF-00001",
    }


@router.post("/portfolio-reset")
async def execute_portfolio_reset(
    payload: PortfolioResetRequest,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> dict:
    if payload.confirmation != PORTFOLIO_RESET_CONFIRMATION:
        raise HTTPException(status_code=422, detail="Confirmation phrase does not match.")

    ip_address = request.client.host if request.client else None
    try:
        return await reset_portfolio(db, actor=admin, ip_address=ip_address)
    except RuntimeError as exc:
        if str(exc) == "A portfolio reset is already in progress.":
            raise HTTPException(status_code=409, detail=str(exc))
        logger.error("Portfolio reset failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Portfolio reset failed. Check server logs.")
    except Exception as exc:
        logger.error("Portfolio reset failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Portfolio reset failed. Check server logs.")

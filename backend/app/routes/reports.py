"""
Reports API — server-side aggregates for the portfolio summary.

GET /api/reports/portfolio-stats
    Returns pre-computed summary statistics:
    - total_active, total_expiring, total_expired, total_incomplete
    - annual_cost_total (subscription / SaaS / maintenance only)
    - by_license_type  (count per LicenseType value)
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser
from app.models.document import Document
from app.models.license import License, LicenseType
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.license_response_service import (
    DEFAULT_NOTIFICATION_DAYS,
    get_mandatory_fields,
    get_procurement_documents_by_scope,
)
from app.services.license_service import compute_stats

router = APIRouter(prefix="/api/reports", tags=["reports"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/portfolio-stats")
async def get_portfolio_stats(
    db: DbSession,
    _current_user: CurrentUser,
) -> dict:
    """Return server-side computed portfolio summary stats for the reports page."""
    mandatory_fields = await get_mandatory_fields(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None

    query = select(License).options(selectinload(License.documents))
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    all_licenses = list(result.scalars().all())

    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, all_licenses)

    documents_by_license_id: dict[int, list[Document]] = {}
    for lic in all_licenses:
        documents_by_license_id[lic.id] = [
            *list(lic.documents),
            *procurement_documents_by_license_id.get(lic.id, []),
        ]

    stats = compute_stats(all_licenses, documents_by_license_id, mandatory_fields, DEFAULT_NOTIFICATION_DAYS)

    # Count active (non-retired) licenses by type
    by_license_type: dict[str, int] = {t.value: 0 for t in LicenseType}
    for lic in all_licenses:
        if not lic.is_retired:
            key = lic.license_type.value if lic.license_type else "unknown"
            by_license_type[key] = by_license_type.get(key, 0) + 1

    return {
        "total_active": stats["total_active"],
        "total_expiring": stats["total_expiring"],
        "total_expired": stats["total_expired"],
        "total_incomplete": stats["total_incomplete"],
        "annual_cost_by_currency": stats["annual_cost_by_currency"],
        "excluded_from_totals": stats["excluded_from_totals"],
        "by_license_type": by_license_type,
    }

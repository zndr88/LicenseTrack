"""
Reports API - scoped, server-side reporting aggregates and exports.

GET /api/reports/portfolio-stats
    Returns pre-computed summary statistics:
    - total_active, total_upcoming, total_expiring, total_expired, total_incomplete
    - annual_cost_by_currency (subscription / SaaS / maintenance only)
    - by_license_type  (count per LicenseType value)
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser
from app.models.document import Document
from app.models.license import License
from app.schemas.report import DetailedReportResponse
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.document_availability_service import available_documents, get_document_storage_base
from app.services.license_response_service import (
    get_mandatory_fields,
    get_notification_days,
    get_procurement_documents_by_scope,
)
from app.services.reporting_service import ReportOptions, build_portfolio_stats, get_detailed_report
from app.services.report_export_service import build_report_export_csv

router = APIRouter(prefix="/api/reports", tags=["reports"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/portfolio-stats")
async def get_portfolio_stats(
    db: DbSession,
    _current_user: CurrentUser,
) -> dict:
    """Return server-side computed portfolio summary stats for the reports page."""
    mandatory_fields = await get_mandatory_fields(db)
    notification_days = await get_notification_days(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None

    query = select(License).options(
        selectinload(License.documents),
        selectinload(License.renewed_to),
    )
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    all_licenses = list(result.scalars().all())

    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, all_licenses)
    storage_base = await get_document_storage_base(db)

    documents_by_license_id: dict[int, list[Document]] = {}
    for lic in all_licenses:
        documents_by_license_id[lic.id] = available_documents(
            [*list(lic.documents), *procurement_documents_by_license_id.get(lic.id, [])],
            storage_base,
        )

    return build_portfolio_stats(
        all_licenses,
        mandatory_fields,
        documents_by_license_id,
        notification_days,
    ).model_dump(by_alias=False)


def _report_options(
    *,
    include_retired: bool,
    date_range: str,
    date_from: date | None,
    date_to: date | None,
    cost_centres: list[str],
    forecast_years: int,
    annual_uplift_pct: Decimal,
    fiscal_year_start_month: int,
    notification_days: int,
) -> ReportOptions:
    if date_range not in {"all", "thisYear", "last12", "custom"}:
        raise HTTPException(status_code=422, detail="Unsupported report date range")
    if date_range == "custom" and (date_from is None or date_to is None):
        raise HTTPException(status_code=422, detail="Custom report ranges require date_from and date_to")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must be before date_to")
    return ReportOptions(
        include_retired=include_retired,
        date_range=date_range,
        date_from=date_from,
        date_to=date_to,
        cost_centres=tuple(" ".join(value.split()) for value in cost_centres if value.strip()),
        forecast_years=forecast_years,
        annual_uplift_pct=annual_uplift_pct,
        fiscal_year_start_month=fiscal_year_start_month,
        notification_days=notification_days,
    )


@router.get("/detailed", response_model=DetailedReportResponse)
async def get_detailed_report_endpoint(
    db: DbSession,
    current_user: CurrentUser,
    include_retired: bool = Query(default=False),
    date_range: str = Query(default="all"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    cost_centres: list[str] = Query(default=[]),
    forecast_years: int = Query(default=5, ge=1, le=10),
    annual_uplift_pct: Decimal = Query(default=Decimal("0"), ge=0, le=100),
    fiscal_year_start_month: int = Query(default=1, ge=1, le=12),
) -> DetailedReportResponse:
    options = _report_options(
        include_retired=include_retired,
        date_range=date_range,
        date_from=date_from,
        date_to=date_to,
        cost_centres=cost_centres,
        forecast_years=forecast_years,
        annual_uplift_pct=annual_uplift_pct,
        fiscal_year_start_month=fiscal_year_start_month,
        notification_days=await get_notification_days(db),
    )
    return await get_detailed_report(db, current_user, options)


@router.get("/detailed/export")
async def export_detailed_report(
    db: DbSession,
    current_user: CurrentUser,
    include_retired: bool = Query(default=False),
    date_range: str = Query(default="all"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    cost_centres: list[str] = Query(default=[]),
    forecast_years: int = Query(default=5, ge=1, le=10),
    annual_uplift_pct: Decimal = Query(default=Decimal("0"), ge=0, le=100),
    fiscal_year_start_month: int = Query(default=1, ge=1, le=12),
) -> StreamingResponse:
    options = _report_options(
        include_retired=include_retired,
        date_range=date_range,
        date_from=date_from,
        date_to=date_to,
        cost_centres=cost_centres,
        forecast_years=forecast_years,
        annual_uplift_pct=annual_uplift_pct,
        fiscal_year_start_month=fiscal_year_start_month,
        notification_days=await get_notification_days(db),
    )
    report = await get_detailed_report(db, current_user, options)
    content = build_report_export_csv(report)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=licensetrack_report_{date.today().isoformat()}.csv"},
    )

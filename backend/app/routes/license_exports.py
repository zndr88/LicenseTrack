import csv
import io
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser
from app.models.license import License
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.license_service import (
    calc_line_total,
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.csv_safety import safe_csv_row
from app.services.settings_service import get_global_settings as _get_cached_global_settings

router = APIRouter(prefix="/api/licenses", tags=["license-exports"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_DEFAULT_NOTIFICATION_DAYS = 30


async def _get_global_settings(db: AsyncSession) -> dict:
    gs = await _get_cached_global_settings(db)
    return gs.mandatory_fields or {} if gs else {}


@router.get("/export")
async def export_licenses(db: DbSession, _current_user: CurrentUser) -> StreamingResponse:
    """Download all active (non-retired) licenses as a CSV file."""
    mandatory_fields = await _get_global_settings(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None
    query = select(License).where(License.is_retired.is_(False)).options(selectinload(License.documents))
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    licenses = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "ID",
        "License Ref",
        "External Ref",
        "Publisher",
        "Software Description",
        "License Type",
        "License Metric",
        "Purchase Quantity",
        "SKU Code",
        "Unit Price",
        "Total PO Value",
        "Currency",
        "Start Date",
        "End Date",
        "Contract Number",
        "PO Number",
        "Invoice Number",
        "Contact Email",
        "Supplier",
        "Cost Centre",
        "Budget Owner Email",
        "Lifecycle Status",
        "Completeness %",
        "Expiration Status",
        "Days Until Expiry",
        "Notes",
    ]
    writer.writerow(headers)

    # Total PO Value is derived, not read from the deprecated total_po_price
    # column: the whole PO's value = sum of line totals (qty × unit price)
    # across the exported licenses sharing a PO number. Mirrors the frontend's
    # getPoTotal, so both exports agree.
    po_totals: dict[str, Decimal] = {}
    for lic in licenses:
        if lic.po_number:
            line = calc_line_total(lic.quantity, lic.unit_price)
            if line is not None:
                po_totals[lic.po_number] = po_totals.get(lic.po_number, Decimal("0")) + line

    today = date.today()
    for lic in licenses:
        docs = list(lic.documents)
        writer.writerow(
            safe_csv_row(
                [
                    lic.id,
                    lic.license_ref or "",
                    lic.external_ref or "",
                    lic.publisher_name,
                    lic.software_description,
                    lic.license_type.value,
                    lic.license_metric.value,
                    lic.quantity,
                    lic.sku_code,
                    lic.unit_price,
                    format(po_totals[lic.po_number], "f") if lic.po_number in po_totals else "",
                    lic.currency,
                    lic.start_date.isoformat() if lic.start_date else "",
                    lic.end_date.isoformat() if lic.end_date else "Perpetual",
                    lic.contract_number,
                    lic.po_number,
                    lic.invoice_number,
                    lic.contact_email,
                    lic.supplier,
                    lic.cost_centre,
                    lic.budget_owner_email,
                    lic.lifecycle_status or "",
                    compute_completeness(lic, docs, mandatory_fields),
                    compute_expiration_status(lic, today, _DEFAULT_NOTIFICATION_DAYS),
                    compute_days_until_expiry(lic, today) if lic.end_date else "",
                    lic.notes or "",
                ]
            )
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=licenses_export.csv"},
    )

import csv
import io
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser
from app.models.license import License
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.document_availability_service import available_documents, get_document_storage_base
from app.services.license_service import (
    calc_effective_quantity,
    calc_line_total,
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.csv_safety import safe_csv_row
from app.services.license_response_service import get_mandatory_fields, get_notification_days
from app.services.audit_service import log_event

router = APIRouter(prefix="/api/licenses", tags=["license-exports"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/export")
async def export_licenses(request: Request, db: DbSession, _current_user: CurrentUser) -> StreamingResponse:
    """Download all active (non-retired) licenses as a CSV file."""
    mandatory_fields = await get_mandatory_fields(db)
    notification_days = await get_notification_days(db)
    storage_base = await get_document_storage_base(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None
    query = select(License).where(License.is_retired.is_(False)).options(selectinload(License.documents))
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    licenses = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "License Record ID",
        "License Ref",
        "External Ref",
        "Publisher",
        "Software Description",
        "License Type",
        "License Metric",
        "Purchase Quantity",
        "Effective Quantity",
        "Quantity Per Unit",
        "SKU Code",
        "Unit Price",
        "Total PO Value",
        "Currency",
        "Start Date",
        "End Date",
        "Notice Date",
        "Contract Number",
        "PO Number",
        "Procurement Reference",
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

    # The whole PO's value is normally the sum of line totals. A manually
    # entered PO override takes precedence and is replicated on every license
    # sharing that PO number. Mirrors the frontend's getPoTotal.
    po_totals: dict[tuple[str, str], Decimal] = {}
    po_overrides = {
        (lic.po_number, lic.currency): Decimal(lic.po_total_override)
        for lic in licenses
        if lic.po_number and lic.po_total_override
    }
    for lic in licenses:
        if lic.po_number:
            key = (lic.po_number, lic.currency)
            if key in po_overrides:
                po_totals[key] = po_overrides[key]
                continue
            line = calc_line_total(lic.quantity, lic.unit_price)
            if line is not None:
                po_totals.setdefault(key, Decimal("0"))
                po_totals[key] += line

    today = date.today()
    for lic in licenses:
        docs = available_documents(lic.documents, storage_base)
        effective_quantity = calc_effective_quantity(lic.quantity, lic.quantity_per_unit)
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
                    format(effective_quantity, "f") if effective_quantity is not None else "",
                    lic.quantity_per_unit,
                    lic.sku_code,
                    lic.unit_price,
                    format(po_totals[(lic.po_number, lic.currency)], "f")
                    if lic.po_number and (lic.po_number, lic.currency) in po_totals
                    else "",
                    lic.currency,
                    lic.start_date.isoformat() if lic.start_date else "",
                    lic.end_date.isoformat() if lic.end_date else "Perpetual",
                    lic.notice_date.isoformat() if lic.notice_date else "",
                    lic.contract_number,
                    lic.po_number,
                    lic.procurement_reference,
                    lic.invoice_number,
                    lic.contact_email,
                    lic.supplier,
                    lic.cost_centre,
                    lic.budget_owner_email,
                    lic.lifecycle_status or "",
                    compute_completeness(lic, docs, mandatory_fields),
                    compute_expiration_status(lic, today, notification_days),
                    compute_days_until_expiry(lic, today) if lic.end_date else "",
                    lic.notes or "",
                ]
            )
        )

    output.seek(0)
    await log_event(
        db,
        "license.csv_exported",
        actor=_current_user,
        ip_address=request.client.host if request.client else None,
        target_type="license_export",
        detail=f"rowCount={len(licenses)}\noutcome=success",
    )
    await db.commit()
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=licenses_export.csv"},
    )

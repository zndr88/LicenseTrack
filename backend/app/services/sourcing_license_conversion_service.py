"""Direct sourcing-to-registry conversion for Freeware / Open Source lines."""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseMetric, LicenseType
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.services.conversion.license_converter import create_purchase_license
from app.services.custom_fields_service import transfer_sourcing_values_to_license
from app.services.sourcing_service import is_direct_freeware_item, refresh_sourcing_request_status


async def convert_freeware_sourcing_items(
    *,
    db: AsyncSession,
    items: list[SourcingItem],
    created_by: int,
) -> list[License]:
    """Create live freeware licenses without manufacturing purchase evidence."""
    if not items:
        raise HTTPException(status_code=422, detail="No Freeware / Open Source items are available to convert")

    created: list[License] = []
    requests: dict[int, SourcingRequest] = {}

    for item in items:
        if item.status != SourcingStatus.sourcing or item.pending_order_id is not None:
            raise HTTPException(status_code=409, detail=f"Sourcing item {item.id} has already been converted")
        if item.license_type != LicenseType.freeware:
            raise HTTPException(
                status_code=422,
                detail=f"Sourcing item {item.id} is not Freeware / Open Source",
            )
        if not is_direct_freeware_item(item):
            raise HTTPException(
                status_code=422,
                detail=f"Sourcing item {item.id} has paid included support and requires the purchase-order workflow",
            )
        if item.renewal_for_license_id is not None:
            raise HTTPException(
                status_code=422,
                detail=f"Sourcing item {item.id} is a renewal and must follow the purchase workflow",
            )

        request = item.sourcing_request
        if request is not None:
            requests[request.id] = request

        contact_email = item.contact_email or (request.contact_email if request else None) or ""
        supplier = item.supplier or (request.supplier if request else None) or ""
        notes = item.notes if item.notes is not None else (request.notes if request else None)

        license_obj = await create_purchase_license(
            db=db,
            item_data={
                "publisher_name": item.publisher_name,
                "software_description": item.software_description,
                "license_type": LicenseType.freeware,
                "license_metric": item.license_metric or LicenseMetric.per_user,
                "portal_url": item.portal_url,
                "quantity": item.quantity or "",
                "quantity_per_unit": item.quantity_per_unit or "1",
                "sku_code": item.sku_code or "",
                "unit_price": "",
                "total_po_price": "",
                "currency": item.currency,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "notice_date": item.notice_date,
                "contract_number": item.contract_number or "",
                "po_number": "",
                "invoice_number": item.invoice_number or "",
                "invoice_numbers": [],
                "pending_order_id": None,
                "source_sourcing_item_id": item.id,
                "request_date": item.created_at,
                "purchase_date": item.purchase_date,
                "maintenance_coverage": item.maintenance_coverage,
                "maintenance_start_date": item.maintenance_start_date,
                "maintenance_end_date": item.maintenance_end_date,
                "maintenance_pricing_basis": item.maintenance_pricing_basis,
                "maintenance_quantity": item.maintenance_quantity,
                "maintenance_unit_price": item.maintenance_unit_price,
                "maintenance_cost": item.maintenance_cost,
                "contact_email": contact_email,
                "supplier": supplier,
                "cost_centre": item.cost_centre or "",
                "budget_owner_email": item.budget_owner_email or "",
                "secondary_contacts": list(item.secondary_contacts or []),
                "external_ref": item.external_ref,
                "notes": notes,
            },
            created_by=created_by,
            created_parent_by_sourcing_item_id={},
            item_id=item.id,
        )
        await transfer_sourcing_values_to_license(db, item.id, license_obj.id)
        item.status = SourcingStatus.converted
        created.append(license_obj)

    for request in requests.values():
        await refresh_sourcing_request_status(db, request)

    return created

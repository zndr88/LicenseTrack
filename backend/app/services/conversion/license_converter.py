from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.services.conversion.maintenance_linker import create_maintenance_purchase
from app.services.license_service import generate_license_ref
from app.services.maintenance_rules import assert_coverage_allowed_for_type, default_maintenance_coverage
from app.services.support_coverage_defaults import apply_bundled_included_support_defaults


async def create_purchase_license(
    *,
    db: AsyncSession,
    item_data: dict,
    created_by: int | None,
    created_parent_by_sourcing_item_id: dict[int, License],
    item_id: int,
) -> License:
    parent_sourcing_item_id = item_data.pop("parent_sourcing_item_id", None)
    license_type = item_data.get("license_type")

    if license_type == LicenseType.perpetual:
        item_data["end_date"] = None
    if license_type == LicenseType.freeware:
        item_data["unit_price"] = ""
        item_data["total_po_price"] = ""
    item_data["quantity_per_unit"] = item_data.get("quantity_per_unit") or "1"

    if license_type == LicenseType.maintenance:
        if parent_sourcing_item_id is not None:
            item_data["parent_sourcing_item_id"] = parent_sourcing_item_id
        return await create_maintenance_purchase(
            db=db,
            item_data=item_data,
            created_by=created_by,
            created_parent_by_sourcing_item_id=created_parent_by_sourcing_item_id,
            item_id=item_id,
        )

    item_data["maintenance_coverage"] = item_data.get("maintenance_coverage") or default_maintenance_coverage(
        license_type
    )
    try:
        assert_coverage_allowed_for_type(license_type, item_data["maintenance_coverage"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Item {item_id}: {exc}")
    apply_bundled_included_support_defaults(item_data)
    if item_data.get("parent_license_id") is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id}: parentLicenseId is only valid for maintenance licenses",
        )
    if parent_sourcing_item_id is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id}: parentSourcingItemId is only valid for maintenance licenses",
        )

    if "invoice_numbers" not in item_data:
        invoice_number = item_data.get("invoice_number") or ""
        item_data["invoice_numbers"] = [invoice_number] if invoice_number else []

    new_license = License(**item_data, created_by=created_by)
    db.add(new_license)
    await db.flush()
    new_license.license_ref = await generate_license_ref(db)
    return new_license

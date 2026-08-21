# backend/app/services/import_/license_builder.py
from __future__ import annotations

from typing import Optional

from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseMetric, LicenseType, MaintenanceCoverage, MaintenancePricingBasis
from app.services.csv_importer import ParsedRow
from app.services.maintenance_service import validate_parent_license
from app.services.maintenance_rules import assert_coverage_allowed_for_type, default_maintenance_coverage
from app.services.po_total_override_service import inherit_po_total_override
from app.services.support_coverage_defaults import apply_bundled_included_support_defaults


async def build_license(
    row: ParsedRow,
    user_id: int,
    db: AsyncSession,
    parent_license_id_override: Optional[int] = None,
) -> License:
    """Construct a License ORM object from a parsed importable row.

    For maintenance rows: resolves parent_license_ref to a parent_license_id.
    For non-maintenance rows with parent_license_ref: treats the ref as a
    renewal predecessor and sets predecessor_id (structural FK only).
    Raises ValueError if a ref is missing, ineligible, retired, or ambiguous.
    """
    license_type = LicenseType(row.license_type) if row.license_type else LicenseType.subscription
    parent_license_id: Optional[int] = parent_license_id_override
    predecessor_id: Optional[int] = None

    if row.parent_license_ref and row.maintenance_parent_action != "import_legacy_unlinked":
        if license_type == LicenseType.maintenance and parent_license_id is None:
            # Maintenance path: resolve ref to a valid perpetual/oem/freeware parent
            parent_result = await db.execute(sa_select(License).where(License.license_ref == row.parent_license_ref))
            parent_matches = parent_result.scalars().all()
            if not parent_matches:
                raise ValueError(
                    f"parent_license_ref={row.parent_license_ref!r} does not resolve to any existing License"
                )
            eligible_parents = []
            for p in parent_matches:
                try:
                    await validate_parent_license(db, p.id)
                    eligible_parents.append(p)
                except ValueError:
                    pass
            if not eligible_parents:
                first = parent_matches[0]
                if first.license_type not in (LicenseType.perpetual, LicenseType.oem, LicenseType.freeware):
                    raise ValueError(
                        f"parent_license_ref={row.parent_license_ref!r} resolves to a "
                        f"{first.license_type.value} License; maintenance can only attach to perpetual, oem, or freeware"
                    )
                raise ValueError(f"parent_license_ref={row.parent_license_ref!r} resolves to a retired License")
            if len(eligible_parents) > 1:
                raise ValueError(
                    f"parent_license_ref={row.parent_license_ref!r} resolves to multiple "
                    f"perpetual, oem, or freeware Licenses; parent selection is ambiguous"
                )
            parent_license_id = eligible_parents[0].id
        elif license_type != LicenseType.maintenance:
            # Renewal path: resolve ref to a predecessor license (FK structural link only).
            # Raise if the ref is ambiguous (multiple matches) to mirror the maintenance path.
            pred_result = await db.execute(sa_select(License).where(License.license_ref == row.parent_license_ref))
            pred_matches = pred_result.scalars().all()
            if len(pred_matches) > 1:
                raise ValueError(
                    f"parent_license_ref={row.parent_license_ref!r} resolves to multiple "
                    f"Licenses; predecessor selection is ambiguous"
                )
            if pred_matches:
                predecessor = pred_matches[0]
                # Guard: reject if predecessor is already part of a renewal chain
                if predecessor.renewed_to_id is not None:
                    raise ValueError(
                        f"parent_license_ref={row.parent_license_ref!r} has already been renewed "
                        f"(license id={predecessor.id} \u2192 successor id={predecessor.renewed_to_id}); "
                        f"correct the reference or remove the parent_license_ref column"
                    )
                predecessor_id = predecessor.id

    resolved_maintenance_coverage = (
        MaintenanceCoverage(row.maintenance_coverage)
        if row.maintenance_coverage
        else default_maintenance_coverage(license_type)
    )
    assert_coverage_allowed_for_type(license_type, resolved_maintenance_coverage)

    data = {
        "publisher_name": row.publisher_name or "Unknown",
        "software_description": row.software_description or "Unknown",
        "license_type": license_type,
        "license_metric": LicenseMetric(row.license_metric) if row.license_metric else LicenseMetric.per_user,
        "maintenance_coverage": resolved_maintenance_coverage,
        "maintenance_start_date": row.db_maintenance_start_date,
        "maintenance_end_date": row.db_maintenance_end_date,
        "maintenance_pricing_basis": (
            MaintenancePricingBasis.flat
            if resolved_maintenance_coverage == MaintenanceCoverage.included and row.maintenance_cost
            else None
        ),
        "maintenance_cost": row.maintenance_cost or None,
        "portal_url": row.portal_url,
        "quantity": row.quantity,
        "quantity_per_unit": row.quantity_per_unit or "1",
        "sku_code": row.sku_code,
        "unit_price": row.unit_price,
        "total_po_price": row.total_po_price,
        "currency": row.currency,
        "start_date": row.db_start_date,
        "end_date": None if license_type == LicenseType.perpetual else row.db_end_date,
        "notice_date": row.db_notice_date,
        "request_date": row.db_request_date,
        "purchase_date": row.db_purchase_date,
        "contract_number": row.contract_number,
        "po_number": row.po_number,
        "procurement_reference": row.procurement_reference,
        "invoice_number": row.invoice_number,
        "invoice_numbers": [row.invoice_number] if row.invoice_number else [],
        "contact_email": row.contact_email,
        "supplier": row.supplier,
        "cost_centre": row.cost_centre,
        "budget_owner_email": row.budget_owner_email,
        "secondary_contacts": row.secondary_contacts,
        "notes": row.notes,
        "is_retired": False,
        "lifecycle_status": row.lifecycle_status,
        "is_completeness_exempt": row.is_completeness_exempt,
        "created_by": user_id,
        "external_ref": row.external_ref if row.external_ref else None,
        "parent_license_id": parent_license_id,
        "is_legacy_unlinked_maintenance": (
            license_type == LicenseType.maintenance
            and row.maintenance_parent_action == "import_legacy_unlinked"
            and parent_license_id is None
        ),
        "predecessor_id": predecessor_id,
    }
    apply_bundled_included_support_defaults(data)
    await inherit_po_total_override(db, data)

    return License(
        **data,
    )

from __future__ import annotations

from typing import Literal

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services.license_service import calc_line_total
from app.services.maintenance_rules import assert_coverage_allowed_for_type, default_maintenance_coverage


RenewalWorkflowState = Literal[
    "active",
    "legacy",
    "retired",
    "renewed",
    "successor",
    "pending_renewal",
    "in_sourcing",
    "pending_order",
]

RenewalWorkbenchStatus = Literal[
    "expired_unresolved",
    "due_soon",
    "pending_renewal",
    "in_sourcing",
    "pending_order",
]


def derive_renewal_workflow_state(
    license_obj: License,
    sourcing_item: SourcingItem | None = None,
) -> RenewalWorkflowState:
    """Return the current renewal workflow state from persisted carriers."""
    if license_obj.is_retired:
        return "retired"
    if license_obj.lifecycle_status == "legacy":
        return "legacy"
    if license_obj.lifecycle_status == "renewed":
        return "renewed"
    if (
        sourcing_item is not None
        and sourcing_item.status != SourcingStatus.cancelled
        and sourcing_item.pending_order_id is not None
    ):
        return "pending_order"
    if sourcing_item is not None and sourcing_item.status != SourcingStatus.cancelled:
        return "in_sourcing"
    if license_obj.lifecycle_status == "pending_renewal":
        return "pending_renewal"
    if license_obj.renewed_from_id is not None:
        return "successor"
    return "active"


def compute_workbench_renewal_status(
    license_obj: License,
    sourcing_item: SourcingItem | None,
    days_until_expiry: int | None,
) -> RenewalWorkbenchStatus:
    """
    Return the renewal workbench status label.

    This intentionally remains a UI/read-model status rather than a complete
    domain state machine; it preserves the existing workbench semantics.
    """
    workflow_state = derive_renewal_workflow_state(license_obj, sourcing_item)
    if workflow_state == "pending_order":
        return "pending_order"
    if workflow_state == "in_sourcing":
        return "in_sourcing"
    if workflow_state == "pending_renewal":
        return "pending_renewal"
    if days_until_expiry is not None and days_until_expiry < 0:
        return "expired_unresolved"
    return "due_soon"


def build_renewal_sourcing_item(
    license_obj: License,
    created_by: int | None,
) -> SourcingItem:
    """Create the sourcing item used to start the renewal procurement flow."""
    license_type = license_obj.license_type
    maintenance_coverage = license_obj.maintenance_coverage or default_maintenance_coverage(license_type)
    assert_coverage_allowed_for_type(license_type, maintenance_coverage)
    return SourcingItem(
        publisher_name=license_obj.publisher_name,
        software_description=license_obj.software_description,
        license_type=license_type,
        maintenance_coverage=MaintenanceCoverage(maintenance_coverage),
        quantity=license_obj.quantity or None,
        estimated_unit_price=license_obj.unit_price or None,
        # Seed with this license's own line total (qty × unit price), not the
        # stored total_po_price: that column is a deprecated whole-PO aggregate.
        estimated_total_price=(
            format(line_total, "f")
            if (line_total := calc_line_total(license_obj.quantity, license_obj.unit_price)) is not None
            else None
        ),
        currency=license_obj.currency,
        supplier=license_obj.supplier or None,
        contact_email=license_obj.contact_email or None,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=license_obj.id,
        created_by=created_by,
    )


def build_pending_order_item_license_data(
    form_data: dict,
    submitted_fields: set[str],
    item: SourcingItem,
    old_license: License | None,
    *,
    order_po_number: str | None = None,
    order_procurement_reference: str | None = None,
    order_supplier: str | None = None,
    order_notes: str | None = None,
) -> dict:
    """
    Build per-item license data without overriding explicitly submitted fields.

    Pending-order and predecessor values are fallbacks only. Membership in
    ``submitted_fields`` distinguishes an omitted field from an explicit null
    or blank value.
    """
    data = dict(form_data)

    def apply_fallback(field: str, *values: object) -> None:
        if field in submitted_fields:
            return
        for value in values:
            if value is not None and value != "":
                data[field] = value
                return

    apply_fallback("publisher_name", item.publisher_name, getattr(old_license, "publisher_name", None))
    apply_fallback(
        "software_description",
        item.software_description,
        getattr(old_license, "software_description", None),
    )
    apply_fallback("license_type", item.license_type, getattr(old_license, "license_type", None))
    apply_fallback("license_metric", getattr(old_license, "license_metric", None))
    apply_fallback("portal_url", getattr(old_license, "portal_url", None))
    apply_fallback("quantity", item.quantity, getattr(old_license, "quantity", None))
    apply_fallback("quantity_per_unit", getattr(old_license, "quantity_per_unit", None))
    apply_fallback("unit_price", item.estimated_unit_price, getattr(old_license, "unit_price", None))
    apply_fallback(
        "total_po_price",
        item.estimated_total_price,
        getattr(old_license, "total_po_price", None),
    )
    apply_fallback("currency", item.currency, getattr(old_license, "currency", None))
    apply_fallback("start_date", item.start_date)
    apply_fallback("end_date", item.end_date)
    apply_fallback(
        "supplier",
        order_supplier,
        item.supplier,
        getattr(old_license, "supplier", None),
    )
    apply_fallback("contact_email", item.contact_email)
    apply_fallback("contract_number", getattr(old_license, "contract_number", None))
    apply_fallback("po_number", order_po_number)
    apply_fallback(
        "procurement_reference",
        order_procurement_reference,
        getattr(old_license, "procurement_reference", None),
    )
    apply_fallback("sku_code", getattr(old_license, "sku_code", None))
    apply_fallback("cost_centre", getattr(old_license, "cost_centre", None))
    apply_fallback("budget_owner_email", getattr(old_license, "budget_owner_email", None))
    apply_fallback("parent_sourcing_item_id", item.parent_sourcing_item_id)
    apply_fallback("maintenance_coverage", item.maintenance_coverage, getattr(old_license, "maintenance_coverage", None))
    apply_fallback(
        "maintenance_start_date",
        item.maintenance_start_date,
        getattr(old_license, "maintenance_start_date", None),
    )
    apply_fallback(
        "maintenance_end_date",
        item.maintenance_end_date,
        getattr(old_license, "maintenance_end_date", None),
    )
    apply_fallback(
        "maintenance_pricing_basis",
        item.maintenance_pricing_basis,
        getattr(old_license, "maintenance_pricing_basis", None),
    )
    apply_fallback(
        "maintenance_quantity",
        item.maintenance_quantity,
        getattr(old_license, "maintenance_quantity", None),
    )
    apply_fallback(
        "maintenance_unit_price",
        item.maintenance_unit_price,
        getattr(old_license, "maintenance_unit_price", None),
    )
    apply_fallback("maintenance_cost", item.maintenance_cost, getattr(old_license, "maintenance_cost", None))

    if old_license is not None and old_license.license_type == LicenseType.maintenance:
        apply_fallback("parent_license_id", old_license.parent_license_id)

    if "notes" not in submitted_fields:
        note_sections = (
            ("Purchase order notes", order_notes),
            ("Line item notes", item.notes),
            ("Previous license notes", getattr(old_license, "notes", None)),
        )
        seen: set[str] = set()
        notes: list[str] = []
        for label, value in note_sections:
            note = str(value or "").strip()
            if not note or note in seen:
                continue
            seen.add(note)
            notes.append(f"{label}:\n{note}")
        if notes:
            data["notes"] = "\n\n".join(notes)

    data["request_date"] = item.created_at

    return data

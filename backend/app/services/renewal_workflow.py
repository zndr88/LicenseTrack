from __future__ import annotations

from typing import Literal

from app.models.license import License, LicenseType
from app.models.sourcing import SourcingItem, SourcingStatus


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
    if license_obj.renewed_from_id is not None:
        return "successor"
    if sourcing_item is not None and sourcing_item.pending_order_id is not None:
        return "pending_order"
    if sourcing_item is not None:
        return "in_sourcing"
    if license_obj.lifecycle_status == "pending_renewal":
        return "pending_renewal"
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
    return SourcingItem(
        publisher_name=license_obj.publisher_name,
        software_description=license_obj.software_description,
        quantity=license_obj.quantity or None,
        estimated_unit_price=license_obj.unit_price or None,
        estimated_total_price=license_obj.total_po_price or None,
        currency=license_obj.currency,
        supplier=license_obj.supplier or None,
        contact_email=license_obj.contact_email or None,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=license_obj.id,
        created_by=created_by,
    )


def build_pending_order_item_license_data(
    form_data: dict,
    item: SourcingItem,
    old_license: License | None,
) -> dict:
    """
    Build per-item license data by overlaying sourcing item fields onto shared
    pending-order conversion data.
    """
    data = dict(form_data)

    data["publisher_name"] = item.publisher_name
    data["software_description"] = item.software_description
    data["request_date"] = item.created_at

    if item.quantity is not None:
        data["quantity"] = item.quantity
    if item.estimated_unit_price is not None:
        data["unit_price"] = item.estimated_unit_price
    if item.estimated_total_price is not None:
        data["total_po_price"] = item.estimated_total_price
    if item.currency:
        data["currency"] = item.currency
    if item.supplier:
        data["supplier"] = item.supplier
    if item.contact_email:
        data["contact_email"] = item.contact_email

    if old_license is not None:
        data["notes"] = None
        data["license_type"] = old_license.license_type
        data["license_metric"] = old_license.license_metric
        if old_license.license_type == LicenseType.maintenance:
            data["parent_license_id"] = old_license.parent_license_id
        if old_license.sku_code:
            data["sku_code"] = old_license.sku_code
        if old_license.cost_centre:
            data["cost_centre"] = old_license.cost_centre
        if old_license.budget_owner_email:
            data["budget_owner_email"] = old_license.budget_owner_email

    return data

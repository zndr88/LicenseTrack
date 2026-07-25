from datetime import date

import pytest
from fastapi import HTTPException

from app.models.license import License, LicenseMetric, LicenseType
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services.lifecycle_rules import mark_pending_renewal, mark_predecessor_renewed
from app.services.renewal_workflow import (
    build_pending_order_item_license_data,
    build_renewal_sourcing_item,
    compute_workbench_renewal_status,
    derive_renewal_workflow_state,
)


def make_license(**overrides) -> License:
    data = {
        "id": 10,
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "25",
        "sku_code": "SKU-1",
        "unit_price": "100",
        "total_po_price": "2500",
        "currency": "EUR",
        "supplier": "Acme Ltd",
        "contact_email": "owner@example.com",
        "cost_centre": "IT",
        "budget_owner_email": "budget@example.com",
        "lifecycle_status": None,
        "is_retired": False,
    }
    data.update(overrides)
    return License(**data)


def make_sourcing_item(**overrides) -> SourcingItem:
    data = {
        "id": 20,
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "quantity": "10",
        "estimated_unit_price": "95",
        "estimated_total_price": "950",
        "currency": "USD",
        "supplier": "Renewals Ltd",
        "contact_email": "renewals@example.com",
        "status": SourcingStatus.sourcing,
        "renewal_for_license_id": 10,
    }
    data.update(overrides)
    return SourcingItem(**data)


def test_derive_renewal_workflow_state_uses_sourcing_and_pending_order_links():
    license_obj = make_license(lifecycle_status="pending_renewal")

    assert derive_renewal_workflow_state(license_obj) == "pending_renewal"
    assert derive_renewal_workflow_state(license_obj, make_sourcing_item()) == "in_sourcing"
    assert (
        derive_renewal_workflow_state(
            license_obj,
            make_sourcing_item(pending_order_id=30),
        )
        == "pending_order"
    )


def test_compute_workbench_renewal_status_preserves_existing_labels():
    license_obj = make_license()

    assert compute_workbench_renewal_status(license_obj, None, -1) == "expired_unresolved"
    assert compute_workbench_renewal_status(license_obj, None, 30) == "due_soon"
    assert (
        compute_workbench_renewal_status(
            make_license(lifecycle_status="pending_renewal"),
            None,
            30,
        )
        == "pending_renewal"
    )
    assert compute_workbench_renewal_status(license_obj, make_sourcing_item(), 30) == "in_sourcing"
    assert (
        compute_workbench_renewal_status(
            license_obj,
            make_sourcing_item(pending_order_id=30),
            30,
        )
        == "pending_order"
    )


@pytest.mark.parametrize("license_type", [LicenseType.subscription, LicenseType.saas])
def test_build_renewal_sourcing_item_prefills_from_license_without_reusing_term(license_type):
    license_obj = make_license(
        id=42,
        created_by=7,
        license_type=license_type,
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
    )

    sourcing_item = build_renewal_sourcing_item(license_obj, created_by=99)

    assert sourcing_item.publisher_name == "Acme"
    assert sourcing_item.software_description == "Acme Suite"
    assert sourcing_item.license_type == license_type
    assert sourcing_item.quantity == "25"
    assert sourcing_item.estimated_unit_price == "100"
    assert sourcing_item.estimated_total_price == "2500"
    assert sourcing_item.currency == "EUR"
    assert sourcing_item.supplier == "Acme Ltd"
    assert sourcing_item.contact_email == "owner@example.com"
    assert sourcing_item.status == SourcingStatus.sourcing
    assert sourcing_item.renewal_for_license_id == 42
    assert sourcing_item.created_by == 99
    assert sourcing_item.start_date is None
    assert sourcing_item.end_date is None


def test_build_pending_order_item_license_data_preserves_submitted_values():
    form_data = {
        "publisher_name": "Form Publisher",
        "software_description": "Form Software",
        "quantity": "1",
        "unit_price": "11",
        "total_po_price": "11",
        "currency": "GBP",
        "start_date": date(2027, 1, 1),
        "end_date": None,
        "supplier": "Form Supplier",
        "contact_email": "form@example.com",
        "license_type": LicenseType.saas,
        "license_metric": LicenseMetric.concurrent,
        "portal_url": None,
        "notes": "",
    }
    old_license = make_license(
        license_type=LicenseType.maintenance,
        license_metric=LicenseMetric.enterprise,
        parent_license_id=77,
        notes="Previous notes",
    )
    item = make_sourcing_item(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), notes="Line notes")

    data = build_pending_order_item_license_data(
        form_data,
        set(form_data),
        item,
        old_license,
        order_po_number="PO-STALE",
        order_supplier="Order Supplier",
        order_notes="Order notes",
    )

    assert data["publisher_name"] == "Form Publisher"
    assert data["software_description"] == "Form Software"
    assert data["quantity"] == "1"
    assert data["unit_price"] == "11"
    assert data["total_po_price"] == "11"
    assert data["currency"] == "GBP"
    assert data["start_date"] == date(2027, 1, 1)
    assert data["end_date"] is None
    assert data["supplier"] == "Form Supplier"
    assert data["contact_email"] == "form@example.com"
    assert data["notes"] == ""
    assert data["license_type"] == LicenseType.saas
    assert data["license_metric"] == LicenseMetric.concurrent
    assert data["portal_url"] is None
    assert data["parent_license_id"] == 77


def test_build_pending_order_item_license_data_fills_only_omitted_fields():
    form_data = {
        "publisher_name": "Form Publisher",
        "software_description": "Form Software",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "",
        "unit_price": "",
        "total_po_price": "",
        "currency": "EUR",
        "supplier": "",
        "contact_email": "",
        "notes": None,
    }
    old_license = make_license(
        license_type=LicenseType.saas,
        license_metric=LicenseMetric.enterprise,
        contract_number="CONTRACT-OLD",
        portal_url="https://old.example.test",
        notes="Shared note",
    )
    item = make_sourcing_item(
        start_date=date(2027, 2, 1),
        end_date=date(2028, 1, 31),
        notes="Shared note",
    )

    data = build_pending_order_item_license_data(
        form_data,
        {"publisher_name", "software_description"},
        item,
        old_license,
        order_po_number="PO-NEW",
        order_supplier="Order Supplier",
        order_notes="PO note",
    )

    assert data["publisher_name"] == "Form Publisher"
    assert data["software_description"] == "Form Software"
    assert data["quantity"] == "10"
    assert data["unit_price"] == "95"
    assert data["total_po_price"] == "950"
    assert data["currency"] == "USD"
    assert data["start_date"] == date(2027, 2, 1)
    assert data["end_date"] == date(2028, 1, 31)
    assert data["supplier"] == "Order Supplier"
    assert data["contact_email"] == "renewals@example.com"
    assert data["license_type"] == LicenseType.saas
    assert data["license_metric"] == LicenseMetric.enterprise
    assert data["contract_number"] == "CONTRACT-OLD"
    assert data["portal_url"] == "https://old.example.test"
    assert data["po_number"] == "PO-NEW"
    assert data["sku_code"] == "SKU-1"
    assert data["cost_centre"] == "IT"
    assert data["budget_owner_email"] == "budget@example.com"
    assert data["notes"] == "Purchase order notes:\nPO note\n\nLine item notes:\nShared note"


def test_mark_pending_renewal_rejects_license_with_existing_successor():
    license_obj = make_license(end_date=date(2026, 12, 31), renewed_to_id=99)

    with pytest.raises(HTTPException) as exc_info:
        mark_pending_renewal(license_obj)

    assert exc_info.value.status_code == 409
    assert license_obj.lifecycle_status is None


def test_mark_pending_renewal_rejects_renewed_license_without_successor_link():
    license_obj = make_license(end_date=date(2026, 12, 31), lifecycle_status="renewed")

    with pytest.raises(HTTPException) as exc_info:
        mark_pending_renewal(license_obj)

    assert exc_info.value.status_code == 409
    assert license_obj.lifecycle_status == "renewed"


def test_mark_predecessor_renewed_does_not_overwrite_existing_successor():
    predecessor = make_license(renewed_to_id=98)

    with pytest.raises(HTTPException) as exc_info:
        mark_predecessor_renewed(predecessor, 99)

    assert exc_info.value.status_code == 409
    assert predecessor.renewed_to_id == 98

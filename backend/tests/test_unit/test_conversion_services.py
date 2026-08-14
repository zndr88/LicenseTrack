from datetime import date

import pytest
from fastapi import HTTPException

from app.models.license import License, LicenseMetric, LicenseType, MaintenanceCoverage
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User, UserRole
from app.services.conversion import license_converter, maintenance_linker, pending_order_status


def _license_data(**overrides) -> dict:
    data = {
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "1",
        "currency": "EUR",
        "start_date": date(2026, 1, 1),
        "end_date": date(2026, 12, 31),
    }
    data.update(overrides)
    return data


def test_refresh_order_status_marks_order_converted_only_when_all_items_converted():
    converted_item = SourcingItem(
        publisher_name="Acme",
        software_description="Converted",
        status=SourcingStatus.converted,
    )
    open_item = SourcingItem(
        publisher_name="Acme",
        software_description="Open",
        status=SourcingStatus.sourcing,
    )
    order = PendingOrder(po_number="PO-1")
    order.items = [converted_item, open_item]

    pending_order_status.refresh_order_status(order)
    assert order.status == PendingOrderStatus.invoice_received

    open_item.status = SourcingStatus.converted
    pending_order_status.refresh_order_status(order)
    assert order.status == PendingOrderStatus.converted


def test_mark_item_converted_sets_status():
    item = SourcingItem(publisher_name="Acme", software_description="Suite")

    pending_order_status.mark_item_converted(item)

    assert item.status == SourcingStatus.converted


async def test_create_purchase_license_creates_perpetual_without_end_date(db_session):
    user = User(username="creator42", email="creator42@test.local", hashed_password="x", role=UserRole.viewer)
    db_session.add(user)
    await db_session.flush()

    data = _license_data(license_type=LicenseType.perpetual, end_date=date(2026, 12, 31))

    new_license = await license_converter.create_purchase_license(
        db=db_session,
        item_data=data,
        created_by=user.id,
        created_parent_by_sourcing_item_id={},
        item_id=10,
    )

    assert new_license.id is not None
    assert new_license.end_date is None
    assert new_license.created_by == user.id
    assert new_license.license_ref.startswith(f"LT-{date.today().year}-")


async def test_create_purchase_license_rejects_parent_for_non_maintenance(db_session):
    data = _license_data(parent_license_id=123)

    with pytest.raises(HTTPException) as exc:
        await license_converter.create_purchase_license(
            db=db_session,
            item_data=data,
            created_by=None,
            created_parent_by_sourcing_item_id={},
            item_id=11,
        )

    assert exc.value.status_code == 400
    assert "parentLicenseId is only valid" in exc.value.detail


async def test_create_purchase_license_rejects_separately_tracked_subscription_support(db_session):
    data = _license_data(
        license_type=LicenseType.subscription,
        maintenance_coverage=MaintenanceCoverage.separately_tracked,
    )

    with pytest.raises(HTTPException) as exc:
        await license_converter.create_purchase_license(
            db=db_session,
            item_data=data,
            created_by=None,
            created_parent_by_sourcing_item_id={},
            item_id=12,
        )

    assert exc.value.status_code == 400
    assert "Use included coverage" in exc.value.detail


async def test_create_purchase_license_mirrors_bundled_subscription_support(db_session):
    data = _license_data(
        license_type=LicenseType.subscription,
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_start_date=date(2025, 1, 1),
        maintenance_end_date=date(2025, 12, 31),
        maintenance_cost="999.00",
        unit_price="300.00",
        total_po_price="3600.00",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )

    new_license = await license_converter.create_purchase_license(
        db=db_session,
        item_data=data,
        created_by=None,
        created_parent_by_sourcing_item_id={},
        item_id=13,
    )

    assert new_license.maintenance_start_date == date(2026, 1, 1)
    assert new_license.maintenance_end_date == date(2026, 12, 31)
    assert new_license.maintenance_cost == "3600.00"


async def test_create_maintenance_purchase_uses_created_parent_map(db_session):
    user = User(username="maintcreator", email="maintcreator@test.local", hashed_password="x", role=UserRole.viewer)
    db_session.add(user)
    await db_session.flush()

    parent = License(**_license_data(license_type=LicenseType.perpetual, end_date=None))
    db_session.add(parent)
    await db_session.flush()
    data = _license_data(
        license_type=LicenseType.maintenance,
        parent_sourcing_item_id=77,
        end_date=date(2027, 12, 31),
        # maintenance_cost mirrors the child's own line total (qty × unit
        # price), not the deprecated stored total_po_price aggregate.
        unit_price="250",
        total_po_price="999.99",
    )

    maintenance = await maintenance_linker.create_maintenance_purchase(
        db=db_session,
        item_data=data,
        created_by=user.id,
        created_parent_by_sourcing_item_id={77: parent},
        item_id=12,
    )

    assert maintenance.parent_license_id == parent.id
    assert maintenance.license_type == LicenseType.maintenance
    assert parent.active_maintenance_id == maintenance.id
    assert parent.maintenance_cost == "250"


async def test_create_maintenance_purchase_rejects_conflicting_parent_sources(db_session):
    data = _license_data(
        license_type=LicenseType.maintenance,
        parent_license_id=1,
        parent_sourcing_item_id=77,
    )

    with pytest.raises(HTTPException) as exc:
        await maintenance_linker.create_maintenance_purchase(
            db=db_session,
            item_data=data,
            created_by=None,
            created_parent_by_sourcing_item_id={},
            item_id=13,
        )

    assert exc.value.status_code == 400
    assert "choose either parentLicenseId or parentSourcingItemId" in exc.value.detail

"""
Unit tests for app.services.sourcing_service.

handle_delete_side_effects — uses a real in-memory SQLite session (db_session
fixture from conftest) so the COUNT queries and ORM mutations work exactly as
they do in production.

build_merged_sourcing_item — pure-function tests, no DB required.

convert_sourcing_item_to_order — uses db_session; covers PO creation, PO
attachment, and error paths.
"""
import pytest
from datetime import date

from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.services.money import MoneyParseError
from app.services.sourcing_service import (
    assert_sourcing_item_editable,
    build_merged_sourcing_item,
    convert_sourcing_item_to_order,
    delete_sourcing_request_record,
    handle_delete_side_effects,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_license(**overrides) -> License:
    defaults = dict(
        publisher_name="Acme",
        software_description="Acme Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        lifecycle_status=None,
        is_retired=False,
    )
    defaults.update(overrides)
    return License(**defaults)


def make_sourcing_item(**overrides) -> SourcingItem:
    defaults = dict(
        publisher_name="Acme",
        software_description="Acme Suite",
        status=SourcingStatus.sourcing,
    )
    defaults.update(overrides)
    return SourcingItem(**defaults)


def make_pending_order(**overrides) -> PendingOrder:
    defaults = dict(po_number="PO-001")
    defaults.update(overrides)
    return PendingOrder(**defaults)


def test_assert_sourcing_item_editable_rejects_converted_item():
    item = make_sourcing_item(status=SourcingStatus.converted)

    with pytest.raises(Exception) as exc_info:
        assert_sourcing_item_editable(item)

    assert getattr(exc_info.value, "status_code", None) == 409


def test_assert_sourcing_item_editable_rejects_item_under_converted_request():
    item = make_sourcing_item(status=SourcingStatus.sourcing)
    item.sourcing_request = SourcingRequest(status=SourcingStatus.converted)

    with pytest.raises(Exception) as exc_info:
        assert_sourcing_item_editable(item)

    assert getattr(exc_info.value, "status_code", None) == 409


def test_assert_sourcing_item_editable_rejects_pending_order_link():
    item = make_sourcing_item(status=SourcingStatus.sourcing, pending_order_id=12)

    with pytest.raises(Exception) as exc_info:
        assert_sourcing_item_editable(item)

    assert getattr(exc_info.value, "status_code", None) == 409


# ---------------------------------------------------------------------------
# Pending-order cleanup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_orphan_pending_order_deleted_when_last_item_removed(db_session):
    po = make_pending_order()
    item = make_sourcing_item()
    db_session.add_all([po, item])
    await db_session.flush()

    item.pending_order_id = po.id
    await db_session.flush()

    # Simulate the route deleting the sourcing item before calling the service
    await db_session.delete(item)
    await db_session.flush()

    await handle_delete_side_effects(db_session, renewal_license_id=None, parent_order_id=po.id)
    await db_session.commit()

    result = await db_session.get(PendingOrder, po.id)
    assert result is None


@pytest.mark.asyncio
async def test_pending_order_survives_when_sibling_items_remain(db_session):
    po = make_pending_order()
    item_a = make_sourcing_item()
    item_b = make_sourcing_item()
    db_session.add_all([po, item_a, item_b])
    await db_session.flush()

    item_a.pending_order_id = po.id
    item_b.pending_order_id = po.id
    await db_session.flush()

    # Delete only item_a; item_b still linked
    await db_session.delete(item_a)
    await db_session.flush()

    await handle_delete_side_effects(db_session, renewal_license_id=None, parent_order_id=po.id)
    await db_session.commit()

    result = await db_session.get(PendingOrder, po.id)
    assert result is not None


# ---------------------------------------------------------------------------
# Renewal license status reset
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_license_pending_renewal_cleared_when_last_sibling_removed(db_session):
    lic = make_license(lifecycle_status="pending_renewal")
    db_session.add(lic)
    await db_session.flush()

    item = make_sourcing_item(renewal_for_license_id=lic.id)
    db_session.add(item)
    await db_session.flush()

    # Simulate deletion of the item
    await db_session.delete(item)
    await db_session.flush()

    await handle_delete_side_effects(db_session, renewal_license_id=lic.id, parent_order_id=None)
    await db_session.commit()

    await db_session.refresh(lic)
    assert lic.lifecycle_status is None


@pytest.mark.asyncio
async def test_license_pending_renewal_kept_when_sibling_exists(db_session):
    lic = make_license(lifecycle_status="pending_renewal")
    db_session.add(lic)
    await db_session.flush()

    item_a = make_sourcing_item(renewal_for_license_id=lic.id)
    item_b = make_sourcing_item(renewal_for_license_id=lic.id)
    db_session.add_all([item_a, item_b])
    await db_session.flush()

    # Delete item_a; item_b still references the license
    await db_session.delete(item_a)
    await db_session.flush()

    await handle_delete_side_effects(db_session, renewal_license_id=lic.id, parent_order_id=None)
    await db_session.commit()

    await db_session.refresh(lic)
    assert lic.lifecycle_status == "pending_renewal"


@pytest.mark.asyncio
async def test_license_with_other_status_is_not_touched(db_session):
    lic = make_license(lifecycle_status="legacy")
    db_session.add(lic)
    await db_session.flush()

    await handle_delete_side_effects(db_session, renewal_license_id=lic.id, parent_order_id=None)
    await db_session.commit()

    await db_session.refresh(lic)
    assert lic.lifecycle_status == "legacy"


@pytest.mark.asyncio
async def test_delete_sourcing_request_cancels_linked_renewal_when_last_reference(db_session):
    lic = make_license(lifecycle_status="pending_renewal")
    request = SourcingRequest(supplier="Acme Vendor", status=SourcingStatus.sourcing)
    db_session.add_all([lic, request])
    await db_session.flush()

    item = make_sourcing_item(
        sourcing_request_id=request.id,
        renewal_for_license_id=lic.id,
    )
    db_session.add(item)
    await db_session.flush()

    label = await delete_sourcing_request_record(db_session, request.id)
    await db_session.commit()

    await db_session.refresh(lic)
    assert label == "Acme Vendor"
    assert lic.lifecycle_status is None
    assert await db_session.get(SourcingRequest, request.id) is None


# ---------------------------------------------------------------------------
# No-op when both IDs are None
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_noop_when_both_ids_are_none(db_session):
    # Should complete without error and touch nothing
    await handle_delete_side_effects(db_session, renewal_license_id=None, parent_order_id=None)


# ---------------------------------------------------------------------------
# build_merged_sourcing_item — pure-function tests
# ---------------------------------------------------------------------------

def make_pred(id: int, start_date=None, **overrides) -> License:
    defaults = dict(
        id=id,
        publisher_name="Acme",
        software_description="Acme Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        start_date=start_date,
        lifecycle_status=None,
        is_retired=False,
    )
    defaults.update(overrides)
    return License(**defaults)


def make_item_for(pred: License, **overrides) -> SourcingItem:
    defaults = dict(
        publisher_name=pred.publisher_name,
        software_description=pred.software_description,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=pred.id,
        quantity="10",
        estimated_unit_price="50.00",
        currency="EUR",
    )
    defaults.update(overrides)
    return SourcingItem(**defaults)


def test_primary_predecessor_is_earliest_start_date():
    pred_old = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_new = make_pred(id=2, start_date=date(2023, 1, 1))
    items = [make_item_for(pred_old), make_item_for(pred_new)]

    merged = build_merged_sourcing_item(items, [pred_new, pred_old], created_by=99)

    assert merged.renewal_for_license_id == pred_old.id


def test_primary_predecessor_tie_break_uses_lowest_id():
    pred_a = make_pred(id=1, start_date=date(2021, 6, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 6, 1))
    items = [make_item_for(pred_a), make_item_for(pred_b)]

    merged = build_merged_sourcing_item(items, [pred_b, pred_a], created_by=99)

    assert merged.renewal_for_license_id == pred_a.id


def test_none_start_date_sorts_before_real_dates():
    pred_no_date = make_pred(id=1, start_date=None)
    pred_dated = make_pred(id=2, start_date=date(2015, 1, 1))
    items = [make_item_for(pred_no_date), make_item_for(pred_dated)]

    merged = build_merged_sourcing_item(items, [pred_dated, pred_no_date], created_by=99)

    assert merged.renewal_for_license_id == pred_no_date.id


def test_merged_item_inherits_fields_from_primary_item():
    pred_primary = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_other = make_pred(id=2, start_date=date(2022, 1, 1))
    primary_item = make_item_for(
        pred_primary,
        publisher_name="Primary Corp",
        software_description="Primary Suite",
        license_type=LicenseType.saas,
        currency="USD",
        supplier="Primary Vendor",
        contact_email="primary@example.com",
        estimated_unit_price="100.00",
    )
    other_item = make_item_for(pred_other, publisher_name="Other Corp")
    items = [primary_item, other_item]

    merged = build_merged_sourcing_item(items, [pred_primary, pred_other], created_by=7)

    assert merged.publisher_name == "Primary Corp"
    assert merged.software_description == "Primary Suite"
    assert merged.license_type == LicenseType.saas
    assert merged.currency == "USD"
    assert merged.supplier is None
    assert merged.contact_email is None
    assert merged.estimated_unit_price == "100.00"
    assert merged.created_by == 7
    assert merged.status == SourcingStatus.sourcing


def test_merged_item_retains_common_request_supplier_and_contact():
    pred_primary = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_other = make_pred(id=2, start_date=date(2022, 1, 1))
    primary_item = make_item_for(pred_primary, supplier="Stale line supplier")
    other_item = make_item_for(pred_other, supplier="Another stale line supplier")
    primary_item.sourcing_request = SourcingRequest(
        supplier="Common Reseller",
        contact_email="buyer@example.com",
    )
    other_item.sourcing_request = SourcingRequest(
        supplier="common reseller",
        contact_email="BUYER@example.com",
    )

    merged = build_merged_sourcing_item(
        [primary_item, other_item],
        [pred_primary, pred_other],
        created_by=7,
    )

    assert merged.supplier == "Common Reseller"
    assert merged.contact_email == "buyer@example.com"


def test_merged_item_falls_back_to_deterministic_primary_predecessor_type():
    pred_primary = make_pred(
        id=1,
        start_date=date(2020, 1, 1),
        license_type=LicenseType.saas,
    )
    pred_other = make_pred(
        id=2,
        start_date=date(2022, 1, 1),
        license_type=LicenseType.subscription,
    )
    items = [
        make_item_for(pred_primary, license_type=None),
        make_item_for(pred_other, license_type=LicenseType.subscription),
    ]

    merged = build_merged_sourcing_item(items, [pred_other, pred_primary], created_by=7)

    assert merged.renewal_for_license_id == pred_primary.id
    assert merged.license_type == LicenseType.saas


def test_quantity_is_sum_of_all_items():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [make_item_for(pred_a, quantity="5"), make_item_for(pred_b, quantity="15")]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.quantity == "20"


def test_null_quantity_treated_as_zero():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [make_item_for(pred_a, quantity=None), make_item_for(pred_b, quantity="8")]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.quantity == "8"


def test_non_numeric_quantity_is_rejected():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [make_item_for(pred_a, quantity="bad"), make_item_for(pred_b, quantity="12")]

    with pytest.raises(MoneyParseError, match="bad"):
        build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)


def test_localized_quantity_is_rejected():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [make_item_for(pred_a, quantity="1,5"), make_item_for(pred_b, quantity="2.5")]

    with pytest.raises(MoneyParseError, match="1,5"):
        build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)


def test_fractional_quantities_are_summed_exactly():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [
        make_item_for(pred_a, quantity="1.5", estimated_unit_price="19.99"),
        make_item_for(pred_b, quantity="2.25"),
    ]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.quantity == "3.75"
    assert merged.estimated_total_price == "74.96"


def test_total_quantity_zero_gives_none_quantity():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [make_item_for(pred_a, quantity=None), make_item_for(pred_b, quantity=None)]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.quantity is None


def test_estimated_total_price_is_unit_price_times_merged_quantity():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [
        make_item_for(pred_a, quantity="5", estimated_unit_price="20.00"),
        make_item_for(pred_b, quantity="10"),
    ]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.estimated_total_price == "300.00"


def test_invalid_unit_price_is_rejected():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [
        make_item_for(pred_a, quantity="5", estimated_unit_price="not-a-number"),
        make_item_for(pred_b, quantity="10"),
    ]

    with pytest.raises(MoneyParseError, match="not-a-number"):
        build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)


def test_estimated_total_price_rounds_half_even_at_two_decimals():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [
        make_item_for(pred_a, quantity="1", estimated_unit_price="0.335"),
        make_item_for(pred_b, quantity="2"),
    ]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.estimated_total_price == "1.00"


def test_none_unit_price_gives_none_total():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2021, 1, 1))
    items = [
        make_item_for(pred_a, quantity="5", estimated_unit_price=None),
        make_item_for(pred_b, quantity="10"),
    ]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b], created_by=1)

    assert merged.estimated_total_price is None


def test_coterm_predecessor_ids_ordered_oldest_first():
    pred_a = make_pred(id=1, start_date=date(2020, 1, 1))
    pred_b = make_pred(id=2, start_date=date(2022, 1, 1))
    pred_c = make_pred(id=3, start_date=date(2018, 1, 1))
    items = [make_item_for(pred_a), make_item_for(pred_b), make_item_for(pred_c)]

    merged = build_merged_sourcing_item(items, [pred_a, pred_b, pred_c], created_by=1)

    assert merged.coterm_predecessor_ids == [3, 1, 2]


# ---------------------------------------------------------------------------
# convert_sourcing_item_to_order
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_creates_new_pending_order_when_none_provided(db_session):
    from app.models.user import User, UserRole
    user = User(username="poowner", email="poowner@test.local", hashed_password="x", role=UserRole.viewer)
    db_session.add(user)
    await db_session.flush()

    item = make_sourcing_item()
    db_session.add(item)
    await db_session.flush()

    order = await convert_sourcing_item_to_order(
        db_session, item,
        pending_order_id=None,
        po_number="PO-999",
        supplier="Acme Vendor",
        notes="test notes",
        created_by=user.id,
    )
    await db_session.commit()

    assert order.po_number == "PO-999"
    assert order.supplier == "Acme Vendor"
    assert order.notes == "test notes"
    assert order.created_by == user.id
    assert item.status == SourcingStatus.converted
    assert item.pending_order_id == order.id


@pytest.mark.asyncio
async def test_attaches_to_existing_pending_order(db_session):
    po = make_pending_order(po_number="PO-EXISTING", supplier="Acme Supplier")
    item = make_sourcing_item()
    db_session.add_all([po, item])
    await db_session.flush()

    order = await convert_sourcing_item_to_order(
        db_session, item,
        pending_order_id=po.id,
        po_number=None,
        supplier=None,
        notes=None,
        created_by=1,
    )
    await db_session.commit()

    assert order.id == po.id
    assert item.status == SourcingStatus.converted
    assert item.pending_order_id == po.id


@pytest.mark.asyncio
async def test_raises_when_pending_order_id_not_found(db_session):
    item = make_sourcing_item()
    db_session.add(item)
    await db_session.flush()

    with pytest.raises(ValueError, match="Pending order not found"):
        await convert_sourcing_item_to_order(
            db_session, item,
            pending_order_id=9999,
            po_number=None,
            supplier=None,
            notes=None,
            created_by=1,
        )


@pytest.mark.asyncio
async def test_raises_when_no_pending_order_id_and_no_po_number(db_session):
    item = make_sourcing_item()
    db_session.add(item)
    await db_session.flush()

    with pytest.raises(ValueError, match="po_number is required"):
        await convert_sourcing_item_to_order(
            db_session, item,
            pending_order_id=None,
            po_number=None,
            supplier=None,
            notes=None,
            created_by=1,
        )

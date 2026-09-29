from sqlalchemy import select

from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder
from app.models.po_line import PoLineRegister
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services import po_line_service
from app.services.po_line_service import allocate_line, sync_license_line, sync_order_lines


def _license(po: str) -> License:
    return License(
        publisher_name="P",
        software_description="S",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        po_number=po,
    )


async def _order_with_items(db, po: str, count: int) -> PendingOrder:
    order = PendingOrder(po_number=po, supplier="Supplier")
    db.add(order)
    await db.flush()
    for index in range(count):
        db.add(
            SourcingItem(
                publisher_name="P",
                software_description=f"Item {index}",
                quantity="1",
                currency="EUR",
                status=SourcingStatus.converted,
                pending_order_id=order.id,
            )
        )
    await db.flush()
    await db.refresh(order, attribute_names=["items"])
    return order


def _numbers(order: PendingOrder) -> list[int]:
    return [item.po_line_number for item in sorted(order.items, key=lambda i: i.id)]


async def test_next_free_is_highest_ever_plus_one_and_never_reused(db_session):
    first = await allocate_line(db_session, "PO-1")
    second = await allocate_line(db_session, "po-1 ")
    assert (first.line_number, second.line_number) == (1, 2)
    assert first.po_key == second.po_key == "po-1"
    third = await allocate_line(db_session, "PO-1")
    assert third.line_number == 3


async def test_po_numbers_are_compared_ignoring_case_and_inner_spacing(db_session):
    first = await allocate_line(db_session, "PO  4500")
    second = await allocate_line(db_session, "po 4500")
    assert (first.line_number, second.line_number) == (1, 2)


async def test_requested_number_is_kept_when_free_else_next(db_session):
    await allocate_line(db_session, "PO-2")
    kept = await allocate_line(db_session, "PO-2", requested=4)
    taken = await allocate_line(db_session, "PO-2", requested=4)
    assert (kept.line_number, taken.line_number) == (4, 5)


async def test_collision_between_read_and_insert_retries(db_session, monkeypatch):
    real_next = po_line_service._next_free_number
    calls = {"n": 0}

    async def racing_next(db, po_key):
        number = await real_next(db, po_key)
        if calls["n"] == 0:
            calls["n"] += 1
            # Another writer takes this number between our read and our insert.
            db.add(PoLineRegister(po_key=po_key, po_number="PO-3", line_number=number))
            await db.flush()
        return number

    monkeypatch.setattr(po_line_service, "_next_free_number", racing_next)
    line = await allocate_line(db_session, "PO-3")
    numbers = sorted(
        (await db_session.execute(select(PoLineRegister.line_number).where(PoLineRegister.po_key == "po-3"))).scalars()
    )
    assert line.line_number == 2
    assert numbers == [1, 2]


async def test_license_keeps_its_number_when_free_on_the_new_po(db_session):
    lic = _license("PO-A")
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    assert lic.po_line_number == 1

    lic.po_number = "PO-B"
    await sync_license_line(db_session, lic)
    assert lic.po_line_number == 1 and lic.po_line.po_key == "po-b"


async def test_license_moves_to_next_free_when_its_number_is_taken(db_session):
    await allocate_line(db_session, "PO-C")
    lic = _license("PO-D")
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    lic.po_number = "PO-C"
    await sync_license_line(db_session, lic)
    assert lic.po_line_number == 2


async def test_clearing_the_po_unlinks_and_the_number_stays_used(db_session):
    lic = _license("PO-E")
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    lic.po_number = ""
    await sync_license_line(db_session, lic)
    await db_session.flush()
    assert lic.po_line_id is None
    assert (await allocate_line(db_session, "PO-E")).line_number == 2


async def test_sync_is_idempotent(db_session):
    lic = _license("PO-F")
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    before = lic.po_line_id
    await sync_license_line(db_session, lic)
    assert lic.po_line_id == before


async def test_order_lines_are_numbered_in_order(db_session):
    order = await _order_with_items(db_session, "PO-G", 3)
    await sync_order_lines(db_session, order)
    assert _numbers(order) == [1, 2, 3]


async def test_order_po_change_keeps_numbers_when_all_are_free(db_session):
    order = await _order_with_items(db_session, "PO-H", 2)
    await sync_order_lines(db_session, order)
    order.po_number = "PO-I"
    await sync_order_lines(db_session, order)
    assert _numbers(order) == [1, 2]


async def test_order_po_change_appends_all_lines_when_any_collides(db_session):
    await allocate_line(db_session, "PO-K")
    await allocate_line(db_session, "PO-K")
    order = await _order_with_items(db_session, "PO-J", 3)
    await sync_order_lines(db_session, order)
    order.po_number = "PO-K"
    await sync_order_lines(db_session, order)
    assert _numbers(order) == [3, 4, 5]


async def test_converted_license_shares_its_lines_number(db_session):
    order = await _order_with_items(db_session, "PO-L", 1)
    await sync_order_lines(db_session, order)
    item = order.items[0]
    lic = _license("po-l")
    lic.source_sourcing_item_id = item.id
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    await db_session.flush()
    assert lic.po_line_id == item.po_line_id

import json
from datetime import date, timedelta

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


# --- Through the API -------------------------------------------------------

_LICENSE = {
    "publisherName": "P",
    "softwareDescription": "S",
    "licenseType": "subscription",
    "licenseMetric": "per_user",
    "quantity": "1",
    "currency": "EUR",
}


def _line(description: str, **overrides) -> dict:
    return {"publisherName": "P", "softwareDescription": description, "quantity": "1", "currency": "EUR", **overrides}


async def _new_license(client, headers, **overrides) -> dict:
    response = await client.post("/api/licenses", json={**_LICENSE, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _new_order(client, headers, po: str, lines: int) -> dict:
    response = await client.post(
        "/api/pending-orders",
        json={"poNumber": po, "supplier": "Supplier", "items": [_line(f"Line {n}") for n in range(lines)]},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _order_numbers(order: dict) -> list[int | None]:
    return [item["poLineNumber"] for item in order["items"]]


async def test_license_api_returns_its_po_line_and_rejects_attempts_to_set_it(test_app, auth_headers):
    created = await _new_license(test_app, auth_headers, poNumber="PO-API")
    assert created["poLineNumber"] == 1
    assert (await _new_license(test_app, auth_headers, poNumber=" po-api ", softwareDescription="Second"))[
        "poLineNumber"
    ] == 2
    assert (await _new_license(test_app, auth_headers, softwareDescription="No PO"))["poLineNumber"] is None

    for payload in ({"poLineNumber": 9}, {"po_line_number": 9}):
        rejected = await test_app.put(f"/api/licenses/{created['id']}", json=payload, headers=auth_headers)
        assert rejected.status_code == 422, rejected.text
    rejected = await test_app.post(
        "/api/licenses", json={**_LICENSE, "poNumber": "PO-API", "poLineNumber": 9}, headers=auth_headers
    )
    assert rejected.status_code == 422


async def test_license_po_edits_keep_or_move_the_number(test_app, auth_headers):
    await _new_license(test_app, auth_headers, poNumber="PO-EDIT-B", softwareDescription="Holds line 1 on B")
    lic = await _new_license(test_app, auth_headers, poNumber="PO-EDIT-A")
    assert lic["poLineNumber"] == 1

    # Line 1 is already used on PO-EDIT-B, so the license moves to the next free line.
    moved = await test_app.put(f"/api/licenses/{lic['id']}", json={"poNumber": "PO-EDIT-B"}, headers=auth_headers)
    assert moved.status_code == 200, moved.text
    assert moved.json()["poLineNumber"] == 2

    # Line 2 is free on PO-EDIT-C, so it is kept.
    kept = await test_app.patch(
        f"/api/licenses/{lic['id']}/field", json={"field": "poNumber", "value": "PO-EDIT-C"}, headers=auth_headers
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["poLineNumber"] == 2

    cleared = await test_app.put(f"/api/licenses/{lic['id']}", json={"poNumber": ""}, headers=auth_headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["poLineNumber"] is None
    # The number stays used up: the next license on PO-EDIT-C gets 3.
    assert (await _new_license(test_app, auth_headers, poNumber="PO-EDIT-C", softwareDescription="Next"))[
        "poLineNumber"
    ] == 3


async def test_pending_order_lines_are_numbered_and_move_together_with_the_po(test_app, auth_headers):
    order = await _new_order(test_app, auth_headers, "PO-ORDER-A", 3)
    assert _order_numbers(order) == [1, 2, 3]

    added = await test_app.post(
        f"/api/pending-orders/{order['id']}/items", json=_line("Late line"), headers=auth_headers
    )
    assert added.status_code in (200, 201), added.text
    assert _order_numbers(added.json()) == [1, 2, 3, 4]

    await _new_license(test_app, auth_headers, poNumber="PO-ORDER-B", softwareDescription="B one")
    await _new_license(test_app, auth_headers, poNumber="PO-ORDER-B", softwareDescription="B two")
    moved = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poNumber": "PO-ORDER-B"}, headers=auth_headers
    )
    assert moved.status_code == 200, moved.text
    assert _order_numbers(moved.json()) == [3, 4, 5, 6]

    free = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poNumber": "PO-ORDER-FREE"}, headers=auth_headers
    )
    assert free.status_code == 200, free.text
    assert _order_numbers(free.json()) == [3, 4, 5, 6]  # nothing taken on the new PO: numbers kept


async def test_converting_an_order_line_gives_the_license_the_same_number(test_app, auth_headers):
    order = await _new_order(test_app, auth_headers, "PO-CONVERT", 1)
    assert _order_numbers(order) == [1]
    form = {**_LICENSE, "unitPrice": "1", "totalPoPrice": "1", "startDate": "2026-01-01", "endDate": "2026-12-31",
            "purchaseDate": "2026-02-01", "poNumber": "PO-CONVERT"}
    converted = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert", data={"data": json.dumps(form)}, headers=auth_headers
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()[0]["poLineNumber"] == 1


async def test_planned_maintenance_terms_are_lines_but_a_renewal_starts_blank(test_app, auth_headers):
    # Three maintenance terms on one PO are three lines, numbered immediately.
    order = await test_app.post(
        "/api/pending-orders",
        json={
            "poNumber": "PO-CHAIN",
            "supplier": "Supplier",
            "items": [
                _line(f"Maintenance year {year}", licenseType="maintenance", licenseMetric="per_user")
                for year in (1, 2, 3)
            ],
        },
        headers=auth_headers,
    )
    assert order.status_code == 201, order.text
    assert _order_numbers(order.json()) == [1, 2, 3]

    # A renewal started through the renewal flow has no line until it has a PO.
    lic = await _new_license(
        test_app,
        auth_headers,
        poNumber="PO-RENEWED",
        endDate=(date.today() + timedelta(days=20)).isoformat(),
        budgetOwnerEmail="owner@example.com",
    )
    started = await test_app.post(f"/api/licenses/{lic['id']}/initiate-renewal", headers=auth_headers)
    assert started.status_code == 200, started.text
    assert started.json()["sourcingItem"]["poLineNumber"] is None
    converted = await test_app.post(
        f"/api/sourcing/{started.json()['sourcingItem']['id']}/convert",
        json={"poNumber": "PO-RENEWAL-2", "supplier": "Supplier"},
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    assert _order_numbers(converted.json()) == [1]


async def test_no_request_can_set_a_line_number_on_orders_or_sourcing_lines(test_app, auth_headers):
    order = await _new_order(test_app, auth_headers, "PO-READONLY", 1)
    for payload in ({"poLineNumber": 7}, {"po_line_number": 7}):
        rejected = await test_app.put(f"/api/pending-orders/{order['id']}", json=payload, headers=auth_headers)
        assert rejected.status_code == 422, rejected.text
    rejected = await test_app.post("/api/sourcing", json={**_line("Sourced"), "poLineNumber": 7}, headers=auth_headers)
    assert rejected.status_code == 422, rejected.text
    rejected = await test_app.post(
        f"/api/pending-orders/{order['id']}/items", json={**_line("Extra"), "poLineNumber": 7}, headers=auth_headers
    )
    assert rejected.status_code == 422, rejected.text

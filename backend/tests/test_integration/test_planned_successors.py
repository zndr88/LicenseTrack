"""Planned successor links through sourcing, PO review, and conversion."""

from datetime import date, timedelta


def _item(name: str, start: str, end: str, *, quantity: str = "10", predecessors=None) -> dict:
    return {
        "publisherName": "Acme",
        "softwareDescription": name,
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": quantity,
        "estimatedUnitPrice": "10",
        "currency": "EUR",
        "startDate": start,
        "endDate": end,
        **({"successorOfItemIds": predecessors} if predecessors else {}),
    }


def _conversion(item: dict) -> dict:
    return {
        "sourcingItemId": item["id"],
        "publisherName": item["publisherName"],
        "softwareDescription": item["softwareDescription"],
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": item["quantity"],
        "unitPrice": "10",
        "currency": "EUR",
        "startDate": item["startDate"],
        "endDate": item["endDate"],
        "purchaseDate": "2026-09-01",
    }


async def _request(client, headers, first: dict) -> dict:
    response = await client.post(
        "/api/sourcing/requests",
        json={"supplier": "Acme Direct", "items": [first]},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _add(client, headers, request_id: int, item: dict) -> dict:
    response = await client.post(f"/api/sourcing/requests/{request_id}/items", json=item, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["items"][-1]


async def test_three_terms_convert_with_secured_future_successors(test_app, auth_headers):
    request = await _request(test_app, auth_headers, _item("Suite 2026", "2026-01-01", "2026-12-31"))
    first = request["items"][0]
    second = await _add(
        test_app, auth_headers, request["id"],
        _item("Renamed Suite 2027", "2027-01-01", "2027-12-31", quantity="12", predecessors=[first["id"]]),
    )
    third = await _add(
        test_app, auth_headers, request["id"],
        _item("Renamed Suite 2028", "2028-01-01", "2028-12-31", predecessors=[second["id"]]),
    )
    reread = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert reread.status_code == 200, reread.text
    by_id = {item["id"]: item for item in reread.json()["items"]}
    assert by_id[first["id"]]["successorSourcingItemId"] == second["id"]
    assert by_id[second["id"]]["successorSourcingItemId"] == third["id"]
    assert by_id[second["id"]]["isRenewal"] is True

    order_response = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert",
        json={"poNumber": "PO-THREE-TERMS", "supplier": "Acme Direct"},
        headers=auth_headers,
    )
    assert order_response.status_code == 200, order_response.text
    order = order_response.json()
    assert {item["successorSourcingItemId"] for item in order["items"]} == {None, second["id"], third["id"]}
    assert next(item for item in order["items"] if item["id"] == third["id"])["isRenewal"] is True
    unlink_in_order = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [], "successorItemId": third["id"]}, headers=auth_headers,
    )
    assert unlink_in_order.status_code == 204, unlink_in_order.text
    relink_in_order = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [second["id"]], "successorItemId": third["id"]},
        headers=auth_headers,
    )
    assert relink_in_order.status_code == 204, relink_in_order.text
    converted = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[_conversion(by_id[item_id]) for item_id in (first["id"], second["id"], third["id"])],
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    terms = {lic["sourceSourcingItemId"]: lic for lic in converted.json() if lic["sourceSourcingItemId"]}
    assert terms[first["id"]]["renewedToId"] == terms[second["id"]]["id"]
    assert terms[second["id"]]["renewedToId"] == terms[third["id"]]["id"]
    assert terms[third["id"]]["renewedFromId"] == terms[second["id"]]["id"]
    assert len({term["licenseRef"] for term in terms.values()}) == 1


async def test_link_three_predecessors_to_one_successor(test_app, auth_headers):
    request = await _request(test_app, auth_headers, _item("Suite A", "2026-01-01", "2026-12-31"))
    first = request["items"][0]
    second = await _add(test_app, auth_headers, request["id"], _item("Suite B", "2026-01-01", "2026-12-31"))
    third = await _add(test_app, auth_headers, request["id"], _item("Suite C", "2026-01-01", "2026-12-31"))
    combined = await _add(
        test_app, auth_headers, request["id"],
        _item("Combined Suite", "2027-01-01", "2027-12-31", quantity="25",
              predecessors=[first["id"], second["id"], third["id"]]),
    )
    order_response = await test_app.post(
        f"/api/sourcing/requests/{request['id']}/convert",
        json={"poNumber": "PO-COMBINED", "supplier": "Acme Direct"}, headers=auth_headers,
    )
    assert order_response.status_code == 200, order_response.text
    converted = await test_app.post(
        f"/api/pending-orders/{order_response.json()['id']}/convert-all",
        json=[_conversion(item) for item in (first, second, third, combined)],
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    terms = {lic["sourceSourcingItemId"]: lic for lic in converted.json() if lic["sourceSourcingItemId"]}
    combined_license = terms[combined["id"]]
    assert set(combined_license["cotermFromIds"]) == {terms[item["id"]]["id"] for item in (first, second, third)}
    assert all(terms[item["id"]]["renewedToId"] == combined_license["id"] for item in (first, second, third))
    assert combined_license["quantity"] == "25"


async def test_successor_links_reject_cycles(test_app, auth_headers):
    request = await _request(test_app, auth_headers, _item("Suite 2026", "2026-01-01", "2026-12-31"))
    first = request["items"][0]
    second = await _add(
        test_app, auth_headers, request["id"],
        _item("Suite 2027", "2027-01-01", "2027-12-31", predecessors=[first["id"]]),
    )
    response = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [second["id"]], "successorItemId": first["id"]},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert "cycle" in response.json()["detail"]


async def test_initial_request_rejects_unresolved_successor_links(test_app, auth_headers):
    response = await test_app.post(
        "/api/sourcing/requests",
        json={
            "supplier": "Acme Direct",
            "items": [_item("Suite 2027", "2027-01-01", "2027-12-31", predecessors=[1])],
        },
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert "Create the sourcing request first" in response.json()["detail"]


async def test_existing_renewal_extends_through_two_purchased_terms(test_app, auth_headers):
    initial_end = date.today() + timedelta(days=10)
    initial_start = initial_end.replace(year=initial_end.year - 1)
    original_response = await test_app.post(
        "/api/licenses",
        json={
            "publisherName": "Acme", "softwareDescription": "Original Suite",
            "licenseType": "subscription", "licenseMetric": "per_user", "quantity": "10",
            "currency": "EUR", "startDate": initial_start.isoformat(),
            "endDate": initial_end.isoformat(), "budgetOwnerEmail": "owner@example.com",
        },
        headers=auth_headers,
    )
    assert original_response.status_code == 201, original_response.text
    original = original_response.json()
    initiated = await test_app.post(
        f"/api/licenses/{original['id']}/initiate-renewal", headers=auth_headers
    )
    assert initiated.status_code == 200, initiated.text
    first = initiated.json()["sourcingItem"]
    first_end = date.fromisoformat(first["endDate"])
    second_start = first_end + timedelta(days=1)
    second_end = first_end.replace(year=first_end.year + 1)
    second = await _add(
        test_app, auth_headers, first["sourcingRequestId"],
        _item("Renamed Suite", second_start.isoformat(), second_end.isoformat(),
              quantity="14", predecessors=[first["id"]]),
    )
    order_response = await test_app.post(
        f"/api/sourcing/requests/{first['sourcingRequestId']}/convert",
        json={"poNumber": "PO-RENEWED-THREE-TERMS", "supplier": "Acme Direct"},
        headers=auth_headers,
    )
    assert order_response.status_code == 200, order_response.text
    converted = await test_app.post(
        f"/api/pending-orders/{order_response.json()['id']}/convert-all",
        json=[_conversion(first), _conversion(second)], headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    by_item = {lic["sourceSourcingItemId"]: lic for lic in converted.json() if lic["sourceSourcingItemId"]}
    first_license = by_item[first["id"]]
    second_license = by_item[second["id"]]
    assert first_license["renewedFromId"] == original["id"]
    assert first_license["renewedToId"] == second_license["id"]
    assert second_license["renewedFromId"] == first_license["id"]
    assert first_license["licenseRef"] == second_license["licenseRef"] == original["licenseRef"]


async def test_link_edit_can_add_and_remove_predecessor_and_blocks_split(test_app, auth_headers):
    request = await _request(test_app, auth_headers, _item("Suite 2026", "2026-01-01", "2026-12-31"))
    first = request["items"][0]
    second = await _add(test_app, auth_headers, request["id"], _item("Suite 2027", "2027-01-01", "2027-12-31"))
    link = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [first["id"]], "successorItemId": second["id"]},
        headers=auth_headers,
    )
    assert link.status_code == 204, link.text
    third = await _add(test_app, auth_headers, request["id"], _item("Suite 2028", "2028-01-01", "2028-12-31"))
    reassign = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [first["id"]], "successorItemId": third["id"]},
        headers=auth_headers,
    )
    assert reassign.status_code == 409
    split = await test_app.post(
        f"/api/sourcing/{first['id']}/convert",
        json={"poNumber": "PO-SPLIT", "supplier": "Acme Direct"}, headers=auth_headers,
    )
    assert split.status_code == 409
    deleted = await test_app.delete(f"/api/sourcing/{second['id']}", headers=auth_headers)
    assert deleted.status_code == 409
    unlink = await test_app.put(
        "/api/sourcing/requests/successor-links",
        json={"predecessorItemIds": [], "successorItemId": second["id"]}, headers=auth_headers,
    )
    assert unlink.status_code == 204, unlink.text
    reread = await test_app.get(f"/api/sourcing/requests/{request['id']}", headers=auth_headers)
    assert reread.status_code == 200, reread.text
    assert reread.json()["items"][0]["successorSourcingItemId"] is None

"""Draft upload targets use server-created IDs, not a stale client item list."""


async def test_bulk_add_returns_only_this_requests_created_ids_in_payload_order(test_app, auth_headers):
    def line(name):
        return {"publisherName": "Acme", "softwareDescription": name, "currency": "EUR"}

    created = await test_app.post(
        "/api/pending-orders", headers=auth_headers,
        json={"poNumber": "PO-TARGETS", "items": [line("Original")]},
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    existing_id = created.json()["items"][0]["id"]
    first_add = await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk", headers=auth_headers,
        json=[line("Other editor")],
    )
    assert first_add.status_code == 201, first_add.text
    other_id = first_add.json()["createdItemIds"][0]
    second_add = await test_app.post(
        f"/api/pending-orders/{order_id}/items/bulk", headers=auth_headers,
        json=[line("Target A"), line("Target B")],
    )
    assert second_add.status_code == 201, second_add.text
    body = second_add.json()
    target_ids = body["createdItemIds"]
    assert len(target_ids) == 2
    assert not {existing_id, other_id}.intersection(target_ids)
    by_id = {item["id"]: item for item in body["items"]}
    assert [by_id[item_id]["softwareDescription"] for item_id in target_ids] == ["Target A", "Target B"]
    assert [item["id"] for item in body["items"]] == sorted(by_id)

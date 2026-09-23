"""Manual PO total on a pending order (single-currency orders only)."""

from app.models.license import License
from sqlalchemy import select


def _line(**overrides) -> dict:
    base = {
        "publisherName": "Acme",
        "softwareDescription": "Suite",
        "licenseType": "subscription",
        "quantity": "1",
        "estimatedUnitPrice": "0",
        "estimatedTotalPrice": "0",
        "currency": "EUR",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
    }
    base.update(overrides)
    return base


async def _order_with_lines(client, headers, lines: list[dict]) -> dict:
    order = await client.post(
        "/api/pending-orders",
        json={"poNumber": "PO-TOTAL", "supplier": "Reseller"},
        headers=headers,
    )
    assert order.status_code == 201, order.text
    added = await client.post(f"/api/pending-orders/{order.json()['id']}/items/bulk", json=lines, headers=headers)
    assert added.status_code == 201, added.text
    return added.json()


async def test_set_and_clear_po_total_override(test_app, auth_headers):
    order = await _order_with_lines(test_app, auth_headers, [_line(), _line(softwareDescription="Add-on")])

    set_resp = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "21000.00"}, headers=auth_headers,
    )
    assert set_resp.status_code == 200, set_resp.text
    assert set_resp.json()["poTotalOverride"] == "21000.00"

    cleared = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poTotalOverride": ""}, headers=auth_headers,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["poTotalOverride"] is None


async def test_override_rejected_for_mixed_currency_orders(test_app, auth_headers):
    order = await _order_with_lines(test_app, auth_headers, [_line(), _line(currency="USD")])

    resp = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "100"}, headers=auth_headers,
    )

    assert resp.status_code == 422
    assert "one currency" in resp.json()["detail"]


async def test_override_invalid_value_rejected(test_app, auth_headers):
    order = await _order_with_lines(test_app, auth_headers, [_line()])

    resp = await test_app.put(
        f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "1.234,50"}, headers=auth_headers,
    )

    assert resp.status_code == 422


async def test_other_currency_line_rejected_while_override_set(test_app, auth_headers):
    order = await _order_with_lines(test_app, auth_headers, [_line()])
    await test_app.put(f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "500"}, headers=auth_headers)

    added = await test_app.post(
        f"/api/pending-orders/{order['id']}/items/bulk", json=[_line(currency="USD")], headers=auth_headers,
    )
    changed = await test_app.put(
        f"/api/pending-orders/{order['id']}/items/{order['items'][0]['id']}",
        json={"currency": "USD"},
        headers=auth_headers,
    )
    same_currency = await test_app.post(
        f"/api/pending-orders/{order['id']}/items/bulk", json=[_line(softwareDescription="More")], headers=auth_headers,
    )

    assert added.status_code == 422
    assert changed.status_code == 422
    assert same_currency.status_code == 201, same_currency.text


async def test_conversion_copies_override_to_every_license_without_touching_lines(
    test_app, auth_headers, db_session,
):
    lines = [_line(softwareDescription=f"Line {index}") for index in range(21)]
    order = await _order_with_lines(test_app, auth_headers, lines)
    await test_app.put(f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "21000.00"}, headers=auth_headers)

    converted = await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[
            {
                "sourcingItemId": item["id"],
                "publisherName": "Acme",
                "softwareDescription": item["softwareDescription"],
                "licenseType": "subscription",
                "licenseMetric": "per_user",
                "quantity": "1",
                "unitPrice": "0",
                "currency": "EUR",
                "startDate": "2026-01-01",
                "endDate": "2026-12-31",
                "purchaseDate": "2026-01-01",
            }
            for item in order["items"]
        ],
        headers=auth_headers,
    )

    assert converted.status_code == 200, converted.text
    rows = converted.json()
    assert len(rows) == 21
    assert {row["poTotalOverride"] for row in rows} == {"21000.00"}
    assert {row["unitPrice"] for row in rows} == {"0"}
    stored = (await db_session.execute(select(License).where(License.pending_order_id == order["id"]))).scalars().all()
    assert {license_obj.po_total_override for license_obj in stored} == {"21000.00"}


async def test_pending_order_export_includes_manual_total(test_app, auth_headers):
    order = await _order_with_lines(test_app, auth_headers, [_line()])
    await test_app.put(f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "750.00"}, headers=auth_headers)

    response = await test_app.get("/api/pending-orders/export", headers=auth_headers)

    assert response.status_code == 200, response.text
    header, row = response.text.splitlines()[:2]
    assert header.endswith("PO Total (manual)")
    assert row.endswith("750.00")


async def test_stats_count_manual_po_totals_not_in_annual_cost(test_app, auth_headers):
    order = await _order_with_lines(
        test_app, auth_headers, [_line(), _line(softwareDescription="Add-on")],
    )
    await test_app.put(f"/api/pending-orders/{order['id']}", json={"poTotalOverride": "21000.00"}, headers=auth_headers)
    today = __import__("datetime").date.today()
    await test_app.post(
        f"/api/pending-orders/{order['id']}/convert-all",
        json=[
            {
                "sourcingItemId": item["id"],
                "publisherName": "Acme",
                "softwareDescription": item["softwareDescription"],
                "licenseType": "subscription",
                "licenseMetric": "per_user",
                "quantity": "1",
                "unitPrice": "0",
                "currency": "EUR",
                "startDate": today.replace(month=1, day=1).isoformat(),
                "endDate": today.replace(month=12, day=31).isoformat(),
                "purchaseDate": today.isoformat(),
            }
            for item in order["items"]
        ],
        headers=auth_headers,
    )

    license_stats = await test_app.get("/api/licenses/stats", headers=auth_headers)
    portfolio = await test_app.get("/api/reports/portfolio-stats", headers=auth_headers)
    report = await test_app.get("/api/reports/detailed", headers=auth_headers)

    assert license_stats.json()["po_overrides_not_in_annual"] == 1
    assert portfolio.status_code == 200, portfolio.text
    assert portfolio.json()["po_overrides_not_in_annual"] == 1
    assert report.status_code == 200, report.text
    assert report.json()["counts"]["poOverridesNotInAnnual"] == 1

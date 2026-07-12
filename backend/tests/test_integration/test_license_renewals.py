from datetime import date, timedelta

from sqlalchemy import func, select

from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus


def _license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "unitPrice": "100",
        "currency": "EUR",
        "endDate": (date.today() + timedelta(days=30)).isoformat(),
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post("/api/licenses", json=_license_payload(**overrides), headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_cancel_renewal_deletes_multiple_sourcing_only_items(
    test_app,
    db_session,
    auth_headers,
):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Duplicate Renewal Source",
    )
    initiate_resp = await test_app.post(
        f"/api/licenses/{license_data['id']}/initiate-renewal",
        headers=auth_headers,
    )
    assert initiate_resp.status_code == 200, initiate_resp.text

    duplicate_request = SourcingRequest(
        supplier="Acme Direct",
        status=SourcingStatus.sourcing,
    )
    db_session.add(duplicate_request)
    await db_session.flush()
    db_session.add(
        SourcingItem(
            sourcing_request_id=duplicate_request.id,
            publisher_name=license_data["publisherName"],
            software_description=license_data["softwareDescription"],
            quantity=license_data["quantity"],
            currency=license_data["currency"],
            status=SourcingStatus.sourcing,
            renewal_for_license_id=license_data["id"],
        )
    )
    await db_session.commit()

    before_count = await db_session.scalar(
        select(func.count(SourcingItem.id)).where(
            SourcingItem.renewal_for_license_id == license_data["id"],
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    assert before_count == 2

    cancel_resp = await test_app.post(
        f"/api/licenses/{license_data['id']}/cancel-renewal",
        headers=auth_headers,
    )

    assert cancel_resp.status_code == 200, cancel_resp.text
    body = cancel_resp.json()
    assert body["license"]["lifecycleStatus"] is None
    assert body["poWarning"] is False

    remaining_items = await db_session.scalar(
        select(func.count(SourcingItem.id)).where(
            SourcingItem.renewal_for_license_id == license_data["id"],
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    assert remaining_items == 0

    empty_sourcing_requests = await db_session.scalar(
        select(func.count(SourcingRequest.id))
        .outerjoin(SourcingItem, SourcingItem.sourcing_request_id == SourcingRequest.id)
        .where(SourcingRequest.status == SourcingStatus.sourcing)
        .group_by(SourcingRequest.id)
        .having(func.count(SourcingItem.id) == 0)
    )
    assert empty_sourcing_requests is None

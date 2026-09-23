"""Renewable Service/Other: opt-in renewability and the Other type description."""

import json
from datetime import date, timedelta

from app.services.license_service import is_recurring_license, is_renewable_license
from types import SimpleNamespace


def _payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Managed Service",
        "licenseType": "service",
        "licenseMetric": "per_user",
        "quantity": "1",
        "unitPrice": "1200",
        "currency": "EUR",
        "budgetOwnerEmail": "owner@example.com",
        "startDate": (date.today() - timedelta(days=300)).isoformat(),
        "endDate": (date.today() + timedelta(days=30)).isoformat(),
    }
    base.update(overrides)
    return base


async def _create(client, headers, **overrides) -> dict:
    resp = await client.post("/api/licenses", json=_payload(**overrides), headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_service_keeps_end_date_and_is_active_without_one(test_app, auth_headers):
    dated = await _create(test_app, auth_headers)
    undated = await _create(test_app, auth_headers, endDate=None)

    assert dated["endDate"] is not None
    assert undated["endDate"] is None
    assert undated["expirationStatus"] == "active"


async def test_is_renewable_only_persists_for_service_and_other(test_app, auth_headers):
    service = await _create(test_app, auth_headers, isRenewable=True)
    subscription = await _create(test_app, auth_headers, licenseType="subscription", isRenewable=True)

    assert service["isRenewable"] is True
    assert subscription["isRenewable"] is None


async def test_other_requires_a_type_description(test_app, auth_headers):
    missing = await test_app.post(
        "/api/licenses",
        json=_payload(licenseType="other"),
        headers=auth_headers,
    )
    created = await _create(test_app, auth_headers, licenseType="other", typeDescription="  Training voucher ")

    assert missing.status_code == 422
    assert created["typeDescription"] == "Training voucher"


async def test_type_description_is_dropped_for_other_types(test_app, auth_headers):
    service = await _create(test_app, auth_headers, typeDescription="Ignored")

    assert service["typeDescription"] is None


async def test_one_off_service_cannot_initiate_renewal_but_renewable_one_can(test_app, auth_headers):
    one_off = await _create(test_app, auth_headers)
    renewable = await _create(test_app, auth_headers, isRenewable=True, softwareDescription="Support Retainer")

    blocked = await test_app.post(f"/api/licenses/{one_off['id']}/initiate-renewal", headers=auth_headers)
    allowed = await test_app.post(f"/api/licenses/{renewable['id']}/initiate-renewal", headers=auth_headers)

    assert blocked.status_code == 400
    assert "renewable" in blocked.json()["detail"]
    assert allowed.status_code in (200, 201), allowed.text


async def test_renewal_line_and_conversion_carry_renewability(test_app, auth_headers):
    source = await _create(
        test_app,
        auth_headers,
        licenseType="other",
        typeDescription="Training voucher",
        isRenewable=True,
    )
    renewal = await test_app.post(f"/api/licenses/{source['id']}/initiate-renewal", headers=auth_headers)
    assert renewal.status_code in (200, 201), renewal.text
    line = renewal.json()["sourcingItem"]
    assert line["isRenewable"] is True
    assert line["typeDescription"] == "Training voucher"

    po = await test_app.post(
        f"/api/sourcing/{line['id']}/convert",
        json={"poNumber": "PO-RENEW-OTHER", "supplier": "Reseller"},
        headers=auth_headers,
    )
    assert po.status_code == 200, po.text
    converted = await test_app.post(
        f"/api/pending-orders/{po.json()['id']}/convert",
        data={"data": json.dumps({
            "publisherName": "Acme Corp",
            "softwareDescription": "Managed Service",
            "startDate": (date.today() + timedelta(days=31)).isoformat(),
            "endDate": (date.today() + timedelta(days=395)).isoformat(),
            "purchaseDate": date.today().isoformat(),
        })},
        headers=auth_headers,
    )
    assert converted.status_code == 200, converted.text
    successor = next(row for row in converted.json() if row["conversionType"] == "renewed")
    assert successor["licenseType"] == "other"
    assert successor["isRenewable"] is True
    assert successor["typeDescription"] == "Training voucher"


def test_renewability_and_recurring_helpers():
    def lic(license_type, is_renewable=None):
        return SimpleNamespace(license_type=license_type, is_renewable=is_renewable)

    assert is_renewable_license(lic("subscription"))
    assert not is_renewable_license(lic("service"))
    assert not is_renewable_license(lic("other", False))
    assert is_renewable_license(lic("other", True))
    assert is_recurring_license(lic("service", True))
    assert not is_recurring_license(lic("service", None))
    assert not is_recurring_license(lic("perpetual"))

"""
Contract tests for the manual Add License request (issue #47).

The frontend tests mock the API and the backend tests used minimal payloads, so
nothing sent the Add License form's full default request to the real endpoint.
These tests post that request, as 1.1.23 built it, for every license type and
coverage option, including a linked maintenance line.
"""

import itertools

import pytest

LICENSE_TYPES = ["subscription", "saas", "perpetual", "oem", "freeware", "service", "other"]
COVERAGES = ["unknown", "not_applicable", "included", "separately_tracked"]
NON_EXPIRING = {"perpetual", "oem", "freeware"}


def _form_payload(license_type: str, coverage: str, **overrides) -> dict:
    """The 1.1.23 Add License request for an otherwise blank form."""
    payload = {
        "publisherName": "Acme",
        "softwareDescription": "Suite",
        "startDate": "2026-01-01",
        "endDate": None if license_type in NON_EXPIRING else "2026-12-31",
        "noticeDate": None,
        "purchaseDate": None,
        "contractNumber": "",
        "poNumber": "",
        "procurementReference": "",
        "invoiceNumber": "",
        "contactEmail": "",
        "supplier": "",
        "costCentre": "",
        "licenseType": license_type,
        "licenseMetric": "per_user",
        "portalUrl": None,
        "isRenewable": False if license_type in ("service", "other") else None,
        "typeDescription": "Consulting" if license_type == "other" else None,
        "quantity": "10",
        "quantityPerUnit": "1",
        "skuCode": "",
        "unitPrice": "5",
        "totalPoPrice": "",
        "currency": "EUR",
        "notes": None,
        "budgetOwnerEmail": "",
        "secondaryContacts": [],
        "externalRef": None,
        "customFieldValues": [],
        "maintenanceCoverage": coverage,
        "maintenanceStartDate": None,
        "maintenanceEndDate": None,
        "maintenancePricingBasis": "flat",
        "maintenanceQuantity": None,
        "maintenanceUnitPrice": None,
        "maintenanceCost": "",
        "isRetired": False,
    }
    payload.update(overrides)
    return payload


def _companion_payload() -> dict:
    """The linked maintenance line added with "Add separate maintenance line"."""
    return _form_payload(
        "maintenance",
        None,
        softwareDescription="Suite maintenance/support",
        endDate="2026-12-31",
        maintenancePricingBasis=None,
    )


FORM_CASES = [
    (license_type, coverage)
    for license_type, coverage in itertools.product(LICENSE_TYPES, COVERAGES)
    if coverage != "separately_tracked" or license_type in NON_EXPIRING
]


@pytest.mark.parametrize("license_type,coverage", FORM_CASES)
async def test_add_license_form_defaults_are_accepted(test_app, auth_headers, license_type, coverage):
    items = [{"license": _form_payload(license_type, coverage)}]
    if coverage == "separately_tracked":
        items.append({"license": _companion_payload(), "parentLineIndex": 0})

    response = await test_app.post("/api/licenses/batch", json={"items": items}, headers=auth_headers)

    assert response.status_code == 201, response.text
    created = response.json()
    assert created[0]["maintenanceCoverage"] == coverage
    assert created[0]["isRetired"] is False


@pytest.mark.parametrize(
    "overrides,blocked",
    [
        ({"maintenanceCost": "100.00"}, "maintenance_cost"),
        ({"maintenancePricingBasis": "per_unit"}, "maintenance_pricing_basis"),
        ({"maintenanceEndDate": "2027-01-01"}, "maintenance_end_date"),
        ({"isRetired": True}, "is_retired"),
    ],
)
async def test_add_license_still_rejects_real_server_owned_values(test_app, auth_headers, overrides, blocked):
    payload = _form_payload("perpetual", "unknown", **overrides)

    response = await test_app.post("/api/licenses/batch", json={"items": [{"license": payload}]}, headers=auth_headers)

    assert response.status_code == 400, response.text
    assert blocked in response.json()["detail"]


@pytest.mark.parametrize("license_type", LICENSE_TYPES)
async def test_add_license_then_full_edit_round_trip(test_app, auth_headers, license_type):
    created = await test_app.post(
        "/api/licenses/batch",
        json={"items": [{"license": _form_payload(license_type, "unknown")}]},
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text
    license_data = created.json()[0]

    edit = {
        "publisherName": license_data["publisherName"],
        "softwareDescription": license_data["softwareDescription"],
        "startDate": license_data.get("startDate") or "",
        "endDate": license_data.get("endDate") or "",
        "noticeDate": "",
        "purchaseDate": None,
        "contractNumber": "",
        "poNumber": "PO-9",
        "procurementReference": "",
        "invoiceNumbers": [],
        "externalRef": "",
        "contactEmail": "",
        "budgetOwnerEmail": "",
        "secondaryContacts": [],
        "supplier": "",
        "costCentre": "",
        "licenseType": license_data["licenseType"],
        "licenseMetric": license_data["licenseMetric"],
        "portalUrl": "",
        "isRenewable": license_data.get("isRenewable"),
        "typeDescription": license_data.get("typeDescription"),
        "quantity": license_data.get("quantity") or "",
        "quantityPerUnit": license_data.get("quantityPerUnit") or "1",
        "skuCode": "",
        "unitPrice": license_data.get("unitPrice") or "",
        "totalPoPrice": license_data.get("totalPoPrice") or "",
        "currency": license_data.get("currency") or "EUR",
        "maintenanceCoverage": license_data["maintenanceCoverage"],
        "notes": "",
        "customFieldValues": [],
    }
    updated = await test_app.put(f"/api/licenses/{license_data['id']}", json=edit, headers=auth_headers)

    assert updated.status_code == 200, updated.text
    assert updated.json()["poNumber"] == "PO-9"

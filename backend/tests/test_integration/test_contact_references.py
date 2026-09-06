"""HTTP coverage for the derived license-contact suggestion source."""


def _license_payload(description: str, owner: str, secondary: list[str]) -> dict:
    return {
        "publisherName": "Contact Reference Publisher",
        "softwareDescription": description,
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "1",
        "currency": "EUR",
        "budgetOwnerEmail": owner,
        "secondaryContacts": secondary,
    }


async def test_contact_search_combines_and_deduplicates_license_contact_roles(test_app, auth_headers):
    first = await test_app.post(
        "/api/licenses",
        json=_license_payload(
            "First contact source",
            "Owner@example.com",
            ["shared@example.com", "technical@example.com"],
        ),
        headers=auth_headers,
    )
    second = await test_app.post(
        "/api/licenses",
        json=_license_payload(
            "Second contact source",
            "shared@example.com",
            ["owner@EXAMPLE.com", "other@different.test"],
        ),
        headers=auth_headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201

    response = await test_app.get(
        "/api/reference-data/contacts/search",
        params={"search": "example"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert [item["email"].casefold() for item in response.json()] == [
        "owner@example.com",
        "shared@example.com",
        "technical@example.com",
    ]


async def test_contact_search_rejects_an_invalid_limit(test_app, auth_headers):
    response = await test_app.get(
        "/api/reference-data/contacts/search",
        params={"search": "example", "limit": 0},
        headers=auth_headers,
    )

    assert response.status_code == 422

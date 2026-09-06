async def test_custom_field_sourcing_visibility_defaults_true_and_can_be_disabled(
    test_app,
    auth_headers,
):
    created = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Invoice date", "fieldType": "date"},
    )

    assert created.status_code == 201
    assert created.json()["showOnSourcingForms"] is True

    updated = await test_app.patch(
        f"/api/custom-fields/{created.json()['id']}",
        headers=auth_headers,
        json={"showOnSourcingForms": False},
    )

    assert updated.status_code == 200
    assert updated.json()["showOnSourcingForms"] is False

    definitions = await test_app.get("/api/custom-fields/", headers=auth_headers)
    assert definitions.status_code == 200
    assert definitions.json()[0]["showOnSourcingForms"] is False


async def test_sourcing_edits_preserve_existing_values_after_field_is_hidden(
    test_app,
    auth_headers,
):
    definition_response = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Invoice date", "fieldType": "date"},
    )
    definition = definition_response.json()
    item_response = await test_app.post(
        "/api/sourcing",
        headers=auth_headers,
        json={
            "publisherName": "Acme",
            "softwareDescription": "Acme Suite",
            "customFieldValues": [
                {"customFieldDefId": definition["id"], "valueText": "2026-09-01"}
            ],
        },
    )
    assert item_response.status_code == 201, item_response.text
    item = item_response.json()

    visibility_response = await test_app.patch(
        f"/api/custom-fields/{definition['id']}",
        headers=auth_headers,
        json={"showOnSourcingForms": False},
    )
    assert visibility_response.status_code == 200, visibility_response.text

    updated_response = await test_app.put(
        f"/api/sourcing/{item['id']}",
        headers=auth_headers,
        json={"softwareDescription": "Acme Suite Pro", "customFieldValues": []},
    )

    assert updated_response.status_code == 200, updated_response.text
    assert updated_response.json()["customFieldValues"] == [
        {
            "customFieldDefId": definition["id"],
            "valueText": "2026-09-01",
            "valueCurrency": None,
        }
    ]

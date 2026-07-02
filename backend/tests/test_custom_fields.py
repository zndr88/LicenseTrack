"""
Tests for custom field definitions and per-license values.

Covers:
- Definition CRUD (admin-only enforcement, ordering, uniqueness, 404)
- Value upsert (partial update, unknown def_id validation, cascade delete)
"""

import bcrypt

from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _minimal_license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "currency": "EUR",
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post("/api/licenses", json=_minimal_license_payload(**overrides), headers=headers)
    assert resp.status_code == 201, f"_create_license failed: {resp.text}"
    return resp.json()


async def _create_definition(client, headers, name="Test Field", field_type="text", display_order=0) -> dict:
    resp = await client.post(
        "/api/custom-fields/",
        json={"name": name, "fieldType": field_type, "displayOrder": display_order},
        headers=headers,
    )
    assert resp.status_code == 201, f"_create_definition failed: {resp.text}"
    return resp.json()


async def _make_editor_headers(db_session, test_app) -> dict:
    password = "editorpass123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    editor = User(
        username="editor_cf",
        email="editor_cf@test.local",
        hashed_password=hashed,
        role=UserRole.editor,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(editor)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "editor_cf", "password": password},
    )
    assert login_resp.status_code == 200
    return {"Authorization": f"Bearer {login_resp.json()['access_token']}"}


async def _make_viewer_headers(db_session, test_app, username: str, departments: list[str]) -> dict:
    password = f"{username}_pass123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    viewer = User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()
    for department in departments:
        db_session.add(UserDepartmentAccess(user_id=viewer.id, department=department))
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert login_resp.status_code == 200
    return {"Authorization": f"Bearer {login_resp.json()['access_token']}"}


# ---------------------------------------------------------------------------
# Definition CRUD tests
# ---------------------------------------------------------------------------

async def test_create_definition_success(test_app, auth_headers):
    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Contract Owner", "fieldType": "text"},
        headers=auth_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["fieldKey"] == "cf_contract_owner"
    assert data["name"] == "Contract Owner"
    assert data["fieldType"] == "text"


async def test_create_definition_duplicate_name_returns_409(test_app, auth_headers):
    await _create_definition(test_app, auth_headers, name="Unique Field")

    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Unique Field", "fieldType": "date"},
        headers=auth_headers,
    )

    assert resp.status_code == 409


async def test_create_definition_invalid_type_returns_422(test_app, auth_headers):
    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Unsupported Field", "fieldType": "json"},
        headers=auth_headers,
    )

    assert resp.status_code == 422


async def test_create_boolean_definition_success(test_app, auth_headers):
    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Uses AI", "fieldType": "boolean"},
        headers=auth_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["fieldKey"] == "cf_uses_ai"
    assert data["fieldType"] == "boolean"


async def test_list_definitions_returns_ordered(test_app, auth_headers):
    await _create_definition(test_app, auth_headers, name="Field C", display_order=20)
    await _create_definition(test_app, auth_headers, name="Field A", display_order=5)
    await _create_definition(test_app, auth_headers, name="Field B", display_order=10)

    resp = await test_app.get("/api/custom-fields/", headers=auth_headers)

    assert resp.status_code == 200
    names = [d["name"] for d in resp.json()]
    assert names == ["Field A", "Field B", "Field C"]


async def test_update_definition_name_does_not_change_field_key(test_app, auth_headers):
    created = await _create_definition(test_app, auth_headers, name="Original Name")
    original_key = created["fieldKey"]

    resp = await test_app.patch(
        f"/api/custom-fields/{created['id']}",
        json={"name": "Updated Name"},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["fieldKey"] == original_key


async def test_delete_definition_returns_affected_count(test_app, auth_headers):
    defn = await _create_definition(test_app, auth_headers, name="To Delete")
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    # Add a value for this field on the license
    put_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "some value"}]},
        headers=auth_headers,
    )
    assert put_resp.status_code == 200

    del_resp = await test_app.delete(
        f"/api/custom-fields/{defn['id']}",
        headers=auth_headers,
    )

    assert del_resp.status_code == 200
    result = del_resp.json()
    assert result["affectedLicenses"] >= 1
    assert result["fieldName"] == "To Delete"

    # Confirm value is gone (cascade)
    get_resp = await test_app.get(
        f"/api/licenses/{license_id}/custom-fields/",
        headers=auth_headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["values"] == []


async def test_delete_nonexistent_definition_returns_404(test_app, auth_headers):
    resp = await test_app.delete("/api/custom-fields/999999", headers=auth_headers)

    assert resp.status_code == 404


async def test_admin_only_create_rejects_non_admin(db_session, test_app):
    editor_headers = await _make_editor_headers(db_session, test_app)

    resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Should Fail", "fieldType": "text"},
        headers=editor_headers,
    )

    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Value upsert tests
# ---------------------------------------------------------------------------

async def test_upsert_and_get_values_for_license(test_app, auth_headers):
    defn = await _create_definition(test_app, auth_headers, name="Owner Email")
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    put_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "owner@acme.com"}]},
        headers=auth_headers,
    )
    assert put_resp.status_code == 200

    get_resp = await test_app.get(
        f"/api/licenses/{license_id}/custom-fields/",
        headers=auth_headers,
    )
    assert get_resp.status_code == 200
    values = get_resp.json()["values"]
    assert len(values) == 1
    assert values[0]["valueText"] == "owner@acme.com"
    assert values[0]["definition"]["id"] == defn["id"]


async def test_license_responses_include_custom_field_values(test_app, auth_headers):
    defn = await _create_definition(test_app, auth_headers, name="Integration Owner")
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    put_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "integration@acme.com"}]},
        headers=auth_headers,
    )
    assert put_resp.status_code == 200

    detail_resp = await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)
    list_resp = await test_app.get("/api/licenses", headers=auth_headers)

    assert detail_resp.status_code == 200
    detail_values = detail_resp.json()["customFields"]
    assert detail_values[0]["valueText"] == "integration@acme.com"
    assert detail_values[0]["definition"]["fieldKey"] == "cf_integration_owner"

    assert list_resp.status_code == 200
    listed_license = next(item for item in list_resp.json() if item["id"] == license_id)
    assert listed_license["customFields"][0]["customFieldDefId"] == defn["id"]


async def test_upsert_updates_existing_value(test_app, auth_headers):
    defn = await _create_definition(test_app, auth_headers, name="Notes Field")
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "first"}]},
        headers=auth_headers,
    )
    await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "second"}]},
        headers=auth_headers,
    )

    get_resp = await test_app.get(
        f"/api/licenses/{license_id}/custom-fields/",
        headers=auth_headers,
    )
    values = get_resp.json()["values"]
    # Should have exactly one value row (updated, not duplicated)
    matching = [v for v in values if v["customFieldDefId"] == defn["id"]]
    assert len(matching) == 1
    assert matching[0]["valueText"] == "second"


async def test_upsert_unknown_def_id_returns_422(test_app, auth_headers):
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": 999999, "valueText": "oops"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 422


async def test_upsert_partial_does_not_delete_other_fields(test_app, auth_headers):
    defn_a = await _create_definition(test_app, auth_headers, name="Field Alpha")
    defn_b = await _create_definition(test_app, auth_headers, name="Field Beta")
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    # Set field A
    await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn_a["id"], "valueText": "alpha value"}]},
        headers=auth_headers,
    )
    # Set field B in a separate call
    await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn_b["id"], "valueText": "beta value"}]},
        headers=auth_headers,
    )

    get_resp = await test_app.get(
        f"/api/licenses/{license_id}/custom-fields/",
        headers=auth_headers,
    )
    values = get_resp.json()["values"]
    assert len(values) == 2
    texts = {v["valueText"] for v in values}
    assert texts == {"alpha value", "beta value"}


async def test_boolean_value_accepts_true_false_and_blank(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="AD Integrated", field_type="boolean"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    true_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": True}]},
        headers=auth_headers,
    )
    assert true_resp.status_code == 200
    assert true_resp.json()["values"][0]["valueText"] == "true"
    assert true_resp.json()["values"][0]["valueCurrency"] is None

    false_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "false"}]},
        headers=auth_headers,
    )
    assert false_resp.status_code == 200
    assert false_resp.json()["values"][0]["valueText"] == "false"

    blank_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": ""}]},
        headers=auth_headers,
    )
    assert blank_resp.status_code == 200
    assert blank_resp.json()["values"][0]["valueText"] is None


async def test_boolean_value_rejects_non_boolean_text(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="Uses AI", field_type="boolean"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "maybe"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 422


async def test_boolean_value_accepts_common_tokens(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="Approved", field_type="boolean"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    yes_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "yes"}]},
        headers=auth_headers,
    )
    assert yes_resp.status_code == 200
    assert yes_resp.json()["values"][0]["valueText"] == "true"

    zero_resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "0"}]},
        headers=auth_headers,
    )
    assert zero_resp.status_code == 200
    assert zero_resp.json()["values"][0]["valueText"] == "false"


async def test_date_value_rejects_non_iso_dates(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="Review Date", field_type="date"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "31/12/2026"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 422
    assert "YYYY-MM-DD" in resp.json()["detail"]


async def test_currency_value_accepts_canonical_values(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="True Up Cost", field_type="currency"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueCurrency": "1000.00"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["values"][0]["valueCurrency"] == "1000.00"


async def test_currency_value_rejects_non_numeric_values(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="Invalid True Up Cost", field_type="currency"
    )
    license_data = await _create_license(test_app, auth_headers)
    license_id = license_data["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueCurrency": "not money"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 422
    assert "plain decimal string" in resp.json()["detail"]


async def test_currency_value_rejects_scientific_notation(test_app, auth_headers):
    defn = await _create_definition(
        test_app, auth_headers, name="Scientific True Up Cost", field_type="currency"
    )
    license_data = await _create_license(test_app, auth_headers)

    resp = await test_app.put(
        f"/api/licenses/{license_data['id']}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueCurrency": "1e2"}]},
        headers=auth_headers,
    )

    assert resp.status_code == 422
    assert "plain decimal string" in resp.json()["detail"]


async def test_viewer_custom_field_reads_are_limited_to_assigned_departments(
    db_session, test_app, auth_headers
):
    defn = await _create_definition(test_app, auth_headers, name="Department Secret")
    it_license = await _create_license(test_app, auth_headers, costCentre="IT")
    hr_license = await _create_license(test_app, auth_headers, costCentre="HR")

    await test_app.put(
        f"/api/licenses/{it_license['id']}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "it value"}]},
        headers=auth_headers,
    )
    await test_app.put(
        f"/api/licenses/{hr_license['id']}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "hr value"}]},
        headers=auth_headers,
    )

    viewer_headers = await _make_viewer_headers(db_session, test_app, "cf_viewer_it", ["IT"])

    all_resp = await test_app.get("/api/custom-fields/values", headers=viewer_headers)
    allowed_resp = await test_app.get(
        f"/api/licenses/{it_license['id']}/custom-fields/",
        headers=viewer_headers,
    )
    denied_resp = await test_app.get(
        f"/api/licenses/{hr_license['id']}/custom-fields/",
        headers=viewer_headers,
    )

    assert all_resp.status_code == 200
    assert {value["valueText"] for value in all_resp.json()["values"]} == {"it value"}
    assert allowed_resp.status_code == 200
    assert allowed_resp.json()["values"][0]["valueText"] == "it value"
    assert denied_resp.status_code == 404


async def test_viewer_cannot_upsert_custom_field_values(
    db_session, test_app, auth_headers
):
    defn = await _create_definition(test_app, auth_headers, name="Viewer Write Blocked")
    license_data = await _create_license(test_app, auth_headers, costCentre="IT")
    viewer_headers = await _make_viewer_headers(db_session, test_app, "cf_viewer_write", ["IT"])

    resp = await test_app.put(
        f"/api/licenses/{license_data['id']}/custom-fields/",
        json={"values": [{"customFieldDefId": defn["id"], "valueText": "viewer edit"}]},
        headers=viewer_headers,
    )

    assert resp.status_code == 403

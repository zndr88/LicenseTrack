"""
Integration tests for license CRUD routes.

Tests the HTTP contract for /api/licenses/* endpoints — status codes,
response shape, and permission enforcement. Business logic is tested in
the B1 unit tests, not here.
"""

import bcrypt

from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Helper — build a minimal valid license payload
# ---------------------------------------------------------------------------

def _minimal_payload(**overrides) -> dict:
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
    """POST a minimal valid license and return the parsed JSON body."""
    resp = await client.post("/api/licenses", json=_minimal_payload(**overrides), headers=headers)
    assert resp.status_code == 201, f"_create_license failed: {resp.text}"
    return resp.json()


# ---------------------------------------------------------------------------
# 2a — GET /api/licenses with empty DB returns []
# ---------------------------------------------------------------------------

async def test_list_licenses_empty(test_app, auth_headers):
    resp = await test_app.get("/api/licenses", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# 2b — POST creates a valid license and returns enriched response
# ---------------------------------------------------------------------------

async def test_create_license_valid(test_app, auth_headers):
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(),
        headers=auth_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["softwareDescription"] == "Acme Suite"
    assert data["createdByName"] == "testadmin"
    assert data["createdByEmail"] == "testadmin@test.local"
    assert "expirationStatus" in data
    assert data["maintenanceCoverage"] == "included"


# ---------------------------------------------------------------------------
# 2c — GET by ID returns the correct record
# ---------------------------------------------------------------------------

async def test_create_saas_license_with_portal_url(test_app, auth_headers):
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(
            licenseType="saas",
            portalUrl="https://portal.example.com",
        ),
        headers=auth_headers,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["portalUrl"] == "https://portal.example.com"


async def test_create_perpetual_license_clears_end_date(test_app, auth_headers):
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(
            licenseType="perpetual",
            endDate="2027-12-31",
        ),
        headers=auth_headers,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["endDate"] is None


async def test_get_license_by_id(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == license_id


# ---------------------------------------------------------------------------
# 2d — GET non-existent ID returns 404
# ---------------------------------------------------------------------------

async def test_get_license_not_found(test_app, auth_headers):
    resp = await test_app.get("/api/licenses/999999", headers=auth_headers)

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 2e — PUT updates a field and reflects it in the response
# ---------------------------------------------------------------------------

async def test_update_license(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}",
        json=_minimal_payload(softwareDescription="Updated Suite"),
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["softwareDescription"] == "Updated Suite"


async def test_update_license_type_to_perpetual_clears_end_date(test_app, auth_headers):
    created = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        endDate="2027-12-31",
    )

    resp = await test_app.put(
        f"/api/licenses/{created['id']}",
        json=_minimal_payload(licenseType="perpetual"),
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["licenseType"] == "perpetual"
    assert resp.json()["endDate"] is None


async def test_license_field_patch_allows_dev_cors_preflight(test_app):
    resp = await test_app.options(
        "/api/licenses/1/field",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "PATCH" in resp.headers["access-control-allow-methods"]


async def test_update_license_accepts_detail_panel_blank_date_payload(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}",
        json={
            "publisherName": "Acme Corp",
            "softwareDescription": "Panel Edited Suite",
            "licenseType": "subscription",
            "licenseMetric": "per_user",
            "quantity": "10",
            "currency": "EUR",
            "startDate": "",
            "endDate": "",
            "contractNumber": "",
            "poNumber": "",
            "invoiceNumber": "",
            "contactEmail": "",
            "supplier": "",
            "costCentre": "",
            "budgetOwnerEmail": "",
            "unitPrice": "",
            "skuCode": "",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["softwareDescription"] == "Panel Edited Suite"
    assert body["startDate"] is None
    assert body["endDate"] is None


async def test_update_license_with_nonempty_contract_number_does_not_crash(test_app, auth_headers):
    """PUT with a non-empty contractNumber triggers _resolve_contract_id's db.execute,
    which causes autoflush. This expired server-generated columns (updated_at) and
    previously caused MissingGreenlet when building the `after` diff dict."""
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.put(
        f"/api/licenses/{license_id}",
        json={
            "publisherName": "Acme Corp",
            "softwareDescription": "Panel Edited Suite",
            "licenseType": "subscription",
            "licenseMetric": "per_user",
            "quantity": "10",
            "currency": "EUR",
            "startDate": "",
            "endDate": "",
            "contractNumber": "LIC-2024-001",
            "poNumber": "",
            "invoiceNumber": "",
            "contactEmail": "",
            "supplier": "",
            "costCentre": "",
            "budgetOwnerEmail": "",
            "unitPrice": "",
            "skuCode": "",
            "portalUrl": "",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["softwareDescription"] == "Panel Edited Suite"
    assert body["contractNumber"] == "LIC-2024-001"


async def test_general_update_rejects_non_legacy_lifecycle_status(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.put(
        f"/api/licenses/{created['id']}",
        json={"lifecycleStatus": "renewed"},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "legacy lifecycle flag" in resp.json()["detail"]


async def test_admin_lifecycle_repair_endpoint_updates_and_audits(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    successor = await _create_license(test_app, auth_headers, softwareDescription="Successor")

    resp = await test_app.post(
        f"/api/licenses/{created['id']}/repair-lifecycle",
        json={
            "lifecycleStatus": "renewed",
            "renewedToId": successor["id"],
            "reason": "Correct renewal chain after import",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["lifecycleStatus"] == "renewed"
    assert resp.json()["renewedToId"] == successor["id"]

    audit_resp = await test_app.get(
        "/api/audit-log?action=license.lifecycle_repaired",
        headers=auth_headers,
    )
    assert audit_resp.status_code == 200, audit_resp.text
    audit_rows = audit_resp.json()["results"]
    assert len(audit_rows) == 1
    assert "mutationType=lifecycle_repair" in audit_rows[0]["detail"]
    assert "reason=Correct renewal chain after import" in audit_rows[0]["detail"]
    assert "lifecycle_status" in audit_rows[0]["detail"]
    assert "renewed_to_id" in audit_rows[0]["detail"]


async def test_lifecycle_repair_requires_reason(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.post(
        f"/api/licenses/{created['id']}/repair-lifecycle",
        json={"lifecycleStatus": "renewed"},
        headers=auth_headers,
    )

    assert resp.status_code == 422


async def test_lifecycle_repair_rejects_missing_target(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.post(
        f"/api/licenses/{created['id']}/repair-lifecycle",
        json={"renewedToId": 999999, "reason": "Point to successor"},
        headers=auth_headers,
    )

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"]


async def test_lifecycle_repair_rejects_self_link(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.post(
        f"/api/licenses/{created['id']}/repair-lifecycle",
        json={"renewedToId": created["id"], "reason": "Bad self repair"},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "itself" in resp.json()["detail"]


async def test_lifecycle_repair_rejects_successor_cycle(test_app, auth_headers):
    first = await _create_license(test_app, auth_headers, softwareDescription="First")
    second = await _create_license(test_app, auth_headers, softwareDescription="Second")

    first_resp = await test_app.post(
        f"/api/licenses/{first['id']}/repair-lifecycle",
        json={"renewedToId": second["id"], "reason": "First successor link"},
        headers=auth_headers,
    )
    assert first_resp.status_code == 200, first_resp.text

    cycle_resp = await test_app.post(
        f"/api/licenses/{second['id']}/repair-lifecycle",
        json={"renewedToId": first["id"], "reason": "Would create cycle"},
        headers=auth_headers,
    )

    assert cycle_resp.status_code == 400
    assert "cycle" in cycle_resp.json()["detail"]


async def test_general_update_rejects_renewal_chain_fields(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    predecessor = await _create_license(test_app, auth_headers, softwareDescription="Predecessor")

    resp = await test_app.put(
        f"/api/licenses/{created['id']}",
        json={"renewedFromId": predecessor["id"]},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "repair fields" in resp.json()["detail"]


async def test_create_maintenance_license_requires_parent(test_app, auth_headers):
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(licenseType="maintenance"),
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Maintenance licenses require parent_license_id"


async def test_create_maintenance_license_rejects_non_perpetual_parent(test_app, auth_headers):
    parent = await _create_license(test_app, auth_headers, licenseType="subscription")

    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(
            licenseType="maintenance",
            parentLicenseId=parent["id"],
        ),
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "maintenance can only attach to perpetual, oem, or freeware Licenses" in resp.json()["detail"]


async def test_create_maintenance_license_accepts_perpetual_parent(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )

    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(
            licenseType="maintenance",
            parentLicenseId=parent["id"],
            startDate="2025-01-01",
            endDate="2025-12-31",
        ),
        headers=auth_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["licenseType"] == "maintenance"
    assert resp.json()["parentLicenseId"] == parent["id"]
    assert resp.json()["maintenanceCoverage"] == "not_applicable"

    parent_resp = await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)
    assert parent_resp.json()["maintenanceCoverage"] == "separately_tracked"


async def test_create_maintenance_license_accepts_freeware_parent(test_app, auth_headers):
    parent = await _create_license(test_app, auth_headers, licenseType="freeware")

    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(
            licenseType="maintenance",
            parentLicenseId=parent["id"],
            endDate="2025-12-31",
        ),
        headers=auth_headers,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["parentLicenseId"] == parent["id"]


async def test_patch_maintenance_coverage_rejects_bundled_support_while_child_is_active(test_app, auth_headers):
    parent = await _create_license(test_app, auth_headers, licenseType="perpetual")
    await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        endDate="2025-12-31",
    )

    resp = await test_app.patch(
        f"/api/licenses/{parent['id']}/field",
        json={"field": "maintenanceCoverage", "value": "included"},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "active maintenance/support record" in resp.json()["detail"]


async def test_disable_maintenance_clears_link(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
    )

    resp = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        json={},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["hasMaintenance"] is False
    assert data["activeMaintenanceId"] is None
    assert data["maintenanceStartDate"] is None
    assert data["maintenanceEndDate"] is None
    assert data["maintenanceCost"] is None

    maintenance_resp = await test_app.get(
        f"/api/licenses/{maintenance['id']}",
        headers=auth_headers,
    )
    assert maintenance_resp.status_code == 200
    assert maintenance_resp.json()["isRetired"] is True


async def test_list_licenses_filtered_by_parent(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
    )
    await _create_license(test_app, auth_headers, softwareDescription="Other Suite")

    resp = await test_app.get(
        f"/api/licenses?parent_license_id={parent['id']}",
        headers=auth_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert [item["id"] for item in data] == [maintenance["id"]]


async def test_disable_maintenance_idempotent(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
    )

    first = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        json={},
        headers=auth_headers,
    )
    second = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        json={},
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["hasMaintenance"] is False
    assert second.json()["activeMaintenanceId"] is None


async def test_disable_maintenance_rejects_non_perpetual(test_app, auth_headers):
    license_obj = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        startDate="2025-01-01",
        endDate="2025-12-31",
    )

    resp = await test_app.post(
        f"/api/licenses/{license_obj['id']}/disable-maintenance",
        json={},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        "Maintenance/support tracking can only be disabled on perpetual, OEM, or freeware Licenses."
    )


async def test_update_license_rejects_parent_for_non_maintenance(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.put(
        f"/api/licenses/{created['id']}",
        json={"parentLicenseId": parent["id"]},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "parent_license_id is only valid for maintenance licenses"


# ---------------------------------------------------------------------------
# 2f — DELETE removes the license; subsequent GET returns 404
# ---------------------------------------------------------------------------

async def test_delete_license(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    del_resp = await test_app.delete(f"/api/licenses/{license_id}", headers=auth_headers)
    assert del_resp.status_code == 204
    assert del_resp.content == b""

    get_resp = await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)
    assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# 2g — POST with invalid licenseType enum returns 422
# ---------------------------------------------------------------------------

async def test_create_license_invalid_enum(test_app, auth_headers):
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(licenseType="banana"),
        headers=auth_headers,
    )

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 2h — PATCH single allowed field updates correctly
# ---------------------------------------------------------------------------

async def test_patch_single_field(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.patch(
        f"/api/licenses/{license_id}/field",
        json={"field": "notes", "value": "test note"},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["notes"] == "test note"


async def test_patch_numeric_field_rejects_non_canonical_value(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.patch(
        f"/api/licenses/{created['id']}/field",
        json={"field": "quantity", "value": "1.234,50"},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "plain decimal string" in resp.json()["detail"]


async def test_patch_portal_url_field(test_app, auth_headers):
    created = await _create_license(
        test_app,
        auth_headers,
        licenseType="saas",
    )
    license_id = created["id"]

    resp = await test_app.patch(
        f"/api/licenses/{license_id}/field",
        json={"field": "portalUrl", "value": "https://portal.example.com"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["portalUrl"] == "https://portal.example.com"


async def test_patch_procurement_milestone_dates(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    request_resp = await test_app.patch(
        f"/api/licenses/{created['id']}/field",
        json={"field": "requestDate", "value": "2025-01-02"},
        headers=auth_headers,
    )
    purchase_resp = await test_app.patch(
        f"/api/licenses/{created['id']}/field",
        json={"field": "purchaseDate", "value": "2025-01-03T14:30:00+00:00"},
        headers=auth_headers,
    )

    assert request_resp.status_code == 200, request_resp.text
    assert request_resp.json()["requestDate"] == "2025-01-02T00:00:00Z"
    assert purchase_resp.status_code == 200, purchase_resp.text
    assert purchase_resp.json()["purchaseDate"] == "2025-01-03T14:30:00Z"


async def test_patch_procurement_milestone_rejects_invalid_date(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)

    resp = await test_app.patch(
        f"/api/licenses/{created['id']}/field",
        json={"field": "requestDate", "value": "not-a-date"},
        headers=auth_headers,
    )

    assert resp.status_code == 400
    assert "Expected YYYY-MM-DD or an ISO datetime" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 2i — PATCH disallowed field returns 400
# ---------------------------------------------------------------------------

async def test_patch_license_type_to_perpetual_clears_end_date(test_app, auth_headers):
    created = await _create_license(
        test_app,
        auth_headers,
        licenseType="subscription",
        endDate="2027-12-31",
    )
    license_id = created["id"]

    resp = await test_app.patch(
        f"/api/licenses/{license_id}/field",
        json={"field": "licenseType", "value": "perpetual"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["licenseType"] == "perpetual"
    assert data["endDate"] is None


async def test_patch_license_type_from_perpetual_to_subscription(test_app, auth_headers):
    created = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        endDate=None,
    )
    license_id = created["id"]

    resp = await test_app.patch(
        f"/api/licenses/{license_id}/field",
        json={"field": "licenseType", "value": "subscription"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["licenseType"] == "subscription"


async def test_patch_disallowed_field(test_app, auth_headers):
    created = await _create_license(test_app, auth_headers)
    license_id = created["id"]

    resp = await test_app.patch(
        f"/api/licenses/{license_id}/field",
        json={"field": "hacked_field", "value": "x"},
        headers=auth_headers,
    )

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 2j — GET /api/licenses/stats returns a dict with "total"
# ---------------------------------------------------------------------------

async def test_get_stats(test_app, auth_headers):
    resp = await test_app.get("/api/licenses/stats", headers=auth_headers)

    assert resp.status_code == 200
    assert "total" in resp.json()


# ---------------------------------------------------------------------------
# 2k — Viewer role cannot create a license (403)
# ---------------------------------------------------------------------------

async def test_viewer_cannot_create_license(db_session, test_app):
    password = "viewerpass123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer1",
        email="viewer1@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer1", "password": password},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    viewer_headers = {"Authorization": f"Bearer {token}"}

    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(),
        headers=viewer_headers,
    )

    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 2l — Bulk delete: deletes found licenses, returns correct count
# ---------------------------------------------------------------------------

async def test_bulk_delete_licenses(test_app, auth_headers):
    # Create 3 licenses
    a = await _create_license(test_app, auth_headers, softwareDescription="A")
    b = await _create_license(test_app, auth_headers, softwareDescription="B")
    c = await _create_license(test_app, auth_headers, softwareDescription="C")

    resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": [a["id"], b["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2

    # Verify A and B are gone
    assert (await test_app.get(f"/api/licenses/{a['id']}", headers=auth_headers)).status_code == 404
    assert (await test_app.get(f"/api/licenses/{b['id']}", headers=auth_headers)).status_code == 404
    # C should still exist
    assert (await test_app.get(f"/api/licenses/{c['id']}", headers=auth_headers)).status_code == 200


# ---------------------------------------------------------------------------
# 2m — Bulk delete: missing IDs silently skipped
# ---------------------------------------------------------------------------

async def test_bulk_delete_missing_ids_skipped(test_app, auth_headers):
    a = await _create_license(test_app, auth_headers)

    resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": [a["id"], 999999]},  # 999999 does not exist
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1  # only the real one counted


# ---------------------------------------------------------------------------
# 2n — Bulk delete: empty ids list returns 0
# ---------------------------------------------------------------------------

async def test_bulk_delete_empty_list(test_app, auth_headers):
    resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": []},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


# ---------------------------------------------------------------------------
# 2o — Bulk delete: viewer cannot bulk delete (403)
# ---------------------------------------------------------------------------

async def test_bulk_delete_viewer_forbidden(db_session, test_app):
    password = "viewerpass456"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer_bulk",
        email="viewer_bulk@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.commit()
    login = await test_app.post("/api/auth/login", json={"username": "viewer_bulk", "password": password})
    token = login.json()["access_token"]
    viewer_headers = {"Authorization": f"Bearer {token}"}

    resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": [1]},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 2p — Bulk delete: active maintenance children are retired, not orphaned
# ---------------------------------------------------------------------------

async def test_bulk_delete_parent_retires_maintenance_children(test_app, auth_headers):
    parent = await _create_license(
        test_app,
        auth_headers,
        licenseType="perpetual",
        startDate="2025-01-01",
        endDate=None,
    )
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        startDate="2025-01-01",
        endDate="2025-12-31",
    )

    resp = await test_app.request(
        "DELETE",
        "/api/licenses/bulk",
        json={"ids": [parent["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1

    # Parent is deleted
    assert (
        await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)
    ).status_code == 404

    # Maintenance child is retired, not deleted
    maintenance_resp = await test_app.get(
        f"/api/licenses/{maintenance['id']}",
        headers=auth_headers,
    )
    assert maintenance_resp.status_code == 200
    assert maintenance_resp.json()["isRetired"] is True


# ---------------------------------------------------------------------------
# F1 regression — chain fields must be rejected on POST /api/licenses
# ---------------------------------------------------------------------------

async def test_create_license_rejects_renewed_from_id(test_app, auth_headers):
    """POST /api/licenses with renewed_from_id set must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(renewedFromId=99),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text


async def test_create_license_rejects_renewed_to_id(test_app, auth_headers):
    """POST /api/licenses with renewed_to_id set must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(renewedToId=99),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text


async def test_create_license_rejects_coterm_from_ids(test_app, auth_headers):
    """POST /api/licenses with coterm_from_ids set must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(cotermFromIds=[1, 2]),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text


async def test_create_license_rejects_renewed_lifecycle_status(test_app, auth_headers):
    """POST /api/licenses with lifecycle_status=renewed must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(lifecycleStatus="renewed"),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text


async def test_create_license_rejects_pending_renewal_lifecycle_status(test_app, auth_headers):
    """POST /api/licenses with lifecycle_status=pending_renewal must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(lifecycleStatus="pending_renewal"),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text


async def test_create_license_allows_legacy_lifecycle_status(test_app, auth_headers):
    """POST /api/licenses with lifecycle_status=legacy is permitted."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(lifecycleStatus="legacy"),
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["lifecycleStatus"] == "legacy"


async def test_create_license_rejects_both_renewal_links_simultaneously(test_app, auth_headers):
    """POST /api/licenses with both renewedFromId and renewedToId set must return 400."""
    resp = await test_app.post(
        "/api/licenses",
        json=_minimal_payload(renewedFromId=5, renewedToId=9),
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text

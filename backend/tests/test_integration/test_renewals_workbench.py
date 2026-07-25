from datetime import date, timedelta

import bcrypt

from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License
from app.models.settings import GlobalSettings
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess


def _license_payload(**overrides) -> dict:
    base = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "unitPrice": "100",
        "currency": "EUR",
        "endDate": (date.today() + timedelta(days=45)).isoformat(),
    }
    base.update(overrides)
    return base


async def _create_license(client, headers, **overrides) -> dict:
    resp = await client.post(
        "/api/licenses",
        json=_license_payload(**overrides),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_viewer(db_session, username: str, departments: list[str]) -> tuple[User, str]:
    password = f"{username}_password"
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
    return viewer, password


async def _login(client, username: str, password: str) -> dict:
    resp = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _initiate_renewal(client, headers, license_id: int) -> dict:
    resp = await client.post(f"/api/licenses/{license_id}/initiate-renewal", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["sourcingItem"]


async def test_workbench_returns_expired_unresolved_row(test_app, auth_headers):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Expired Tool",
        endDate=(date.today() - timedelta(days=3)).isoformat(),
    )

    resp = await test_app.get("/api/renewals/workbench", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    row = next(row for row in rows if row["licenseId"] == license_data["id"])
    assert row["renewalStatus"] == "expired_unresolved"
    assert row["daysUntilExpiry"] == -3
    assert {"expired", "renewal_not_started"}.issubset({flag["code"] for flag in row["riskFlags"]})


async def test_workbench_returns_due_soon_row(test_app, auth_headers):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Due Soon Tool",
        endDate=(date.today() + timedelta(days=20)).isoformat(),
    )

    resp = await test_app.get("/api/renewals/workbench?view=due_30", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert [row["licenseId"] for row in rows] == [license_data["id"]]
    assert rows[0]["renewalStatus"] == "due_soon"
    assert rows[0]["daysUntilExpiry"] == 20


async def test_workbench_completeness_includes_procurement_documents(db_session, test_app, auth_headers):
    db_session.add(GlobalSettings(id=1, mandatory_fields={"invoice": True}))
    await db_session.commit()
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Procurement Evidence Tool",
        endDate=(date.today() + timedelta(days=20)).isoformat(),
    )
    db_session.add(
        ProcurementDocument(
            po_number="PO-PROC-1",
            license_id=license_data["id"],
            filename="stored-invoice.pdf",
            original_filename="invoice.pdf",
            file_size=1234,
            mime_type="application/pdf",
            category=ProcurementDocumentCategory.invoice,
        )
    )
    await db_session.commit()

    resp = await test_app.get("/api/renewals/workbench?view=due_30", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(row for row in resp.json() if row["licenseId"] == license_data["id"])
    assert row["completenessPct"] == 100
    assert row["documentCount"] == 1
    assert "incomplete" not in {flag["code"] for flag in row["riskFlags"]}


async def test_workbench_links_pending_renewal_sourcing_item(test_app, auth_headers):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Sourcing Renewal Tool",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, license_data["id"])

    resp = await test_app.get("/api/renewals/workbench?view=in_progress", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(row for row in resp.json() if row["licenseId"] == license_data["id"])
    assert row["renewalStatus"] == "in_sourcing"
    assert row["lifecycleStatus"] == "pending_renewal"
    assert row["sourcingItemId"] == sourcing_item["id"]
    assert row["pendingOrderId"] is None


async def test_workbench_links_pending_order(test_app, auth_headers):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Pending Order Renewal Tool",
    )
    sourcing_item = await _initiate_renewal(test_app, auth_headers, license_data["id"])
    po_resp = await test_app.post(
        f"/api/sourcing/{sourcing_item['id']}/convert",
        json={"poNumber": "PO-RENEW-1", "supplier": "Renewal Supplier"},
        headers=auth_headers,
    )
    assert po_resp.status_code == 200, po_resp.text
    pending_order = po_resp.json()

    resp = await test_app.get("/api/renewals/workbench?view=in_progress", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(row for row in resp.json() if row["licenseId"] == license_data["id"])
    assert row["renewalStatus"] == "pending_order"
    assert row["pendingOrderId"] == pending_order["id"]
    assert row["pendingOrderNumber"] == "PO-RENEW-1"
    assert any(flag["code"] == "pending_order" for flag in row["riskFlags"])


async def test_workbench_respects_viewer_department_scope(db_session, test_app, auth_headers):
    it_license = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="IT Tool",
        costCentre="IT",
    )
    hr_license = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="HR Tool",
        costCentre="HR",
    )
    _, password = await _create_viewer(db_session, "renewal_viewer", ["IT"])
    viewer_headers = await _login(test_app, "renewal_viewer", password)

    resp = await test_app.get("/api/renewals/workbench", headers=viewer_headers)

    assert resp.status_code == 200, resp.text
    ids = [row["licenseId"] for row in resp.json()]
    assert it_license["id"] in ids
    assert hr_license["id"] not in ids


async def test_workbench_includes_custom_fields(test_app, auth_headers):
    def_resp = await test_app.post(
        "/api/custom-fields/",
        json={"name": "Renewal Owner", "fieldType": "text"},
        headers=auth_headers,
    )
    assert def_resp.status_code == 201, def_resp.text
    definition = def_resp.json()
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Custom Field Tool",
    )
    value_resp = await test_app.put(
        f"/api/licenses/{license_data['id']}/custom-fields/",
        json={"values": [{"customFieldDefId": definition["id"], "valueText": "owner@example.com"}]},
        headers=auth_headers,
    )
    assert value_resp.status_code == 200, value_resp.text

    resp = await test_app.get("/api/renewals/workbench", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(row for row in resp.json() if row["licenseId"] == license_data["id"])
    assert row["customFields"] == [
        {
            "fieldKey": definition["fieldKey"],
            "name": "Renewal Owner",
            "fieldType": "text",
            "valueText": "owner@example.com",
            "valueCurrency": None,
            "section": None,
        }
    ]


async def test_workbench_requires_authentication(test_app):
    resp = await test_app.get("/api/renewals/workbench")

    assert resp.status_code == 401


async def test_workbench_rejects_invalid_view_and_window(test_app, auth_headers):
    bad_view = await test_app.get("/api/renewals/workbench?view=not_a_view", headers=auth_headers)
    assert bad_view.status_code == 422

    bad_window = await test_app.get("/api/renewals/workbench?window_days=-1", headers=auth_headers)
    assert bad_window.status_code == 422


async def test_workbench_excludes_retired_renewed_and_legacy(test_app, auth_headers):
    retired = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Retired Tool",
        endDate=(date.today() + timedelta(days=10)).isoformat(),
    )
    renewed = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Renewed Tool",
        endDate=(date.today() + timedelta(days=10)).isoformat(),
    )
    legacy = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Legacy Tool",
        endDate=(date.today() + timedelta(days=10)).isoformat(),
    )

    retire_resp = await test_app.put(
        f"/api/licenses/{retired['id']}",
        json={"isRetired": True},
        headers=auth_headers,
    )
    assert retire_resp.status_code == 200, retire_resp.text
    renewed_resp = await test_app.post(
        f"/api/licenses/{renewed['id']}/repair-lifecycle",
        json={"lifecycleStatus": "renewed", "reason": "Mark as renewed for workbench coverage"},
        headers=auth_headers,
    )
    assert renewed_resp.status_code == 200, renewed_resp.text
    legacy_resp = await test_app.put(
        f"/api/licenses/{legacy['id']}",
        json={"lifecycleStatus": "legacy"},
        headers=auth_headers,
    )
    assert legacy_resp.status_code == 200, legacy_resp.text

    resp = await test_app.get("/api/renewals/workbench", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    ids = {row["licenseId"] for row in resp.json()}
    assert retired["id"] not in ids
    assert renewed["id"] not in ids
    assert legacy["id"] not in ids


async def test_workbench_includes_pending_renewal_outside_window(test_app, auth_headers):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Far Future Renewal Tool",
        endDate=(date.today() + timedelta(days=400)).isoformat(),
    )
    await _initiate_renewal(test_app, auth_headers, license_data["id"])

    resp = await test_app.get("/api/renewals/workbench?window_days=1", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(row for row in resp.json() if row["licenseId"] == license_data["id"])
    assert row["renewalStatus"] == "in_sourcing"


async def test_workbench_high_value_flag_respects_configured_threshold(
    db_session, test_app, auth_headers
):
    # Set a low threshold so a modest-value license triggers high_value
    result = await db_session.execute(__import__("sqlalchemy").select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = result.scalar_one_or_none()
    if gs is None:
        gs = GlobalSettings(id=1)
        db_session.add(gs)
    gs.high_value_threshold = 5000
    await db_session.commit()

    # quantity=10, unitPrice=600 → estimatedAnnualValue=6000, which is ≥5000
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Modest Value Tool",
        quantity="10",
        unitPrice="600",
        endDate=(date.today() + timedelta(days=45)).isoformat(),
    )

    resp = await test_app.get("/api/renewals/workbench", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    row = next(r for r in resp.json() if r["licenseId"] == license_data["id"])
    flag_codes = {f["code"] for f in row["riskFlags"]}
    assert "high_value" in flag_codes

    # high_value view should include this row
    view_resp = await test_app.get("/api/renewals/workbench?view=high_value", headers=auth_headers)
    assert view_resp.status_code == 200, view_resp.text
    view_ids = {r["licenseId"] for r in view_resp.json()}
    assert license_data["id"] in view_ids


async def test_workbench_flags_invalid_legacy_numeric_data_without_changing_response_type(
    db_session,
    test_app,
    auth_headers,
):
    license_data = await _create_license(
        test_app,
        auth_headers,
        softwareDescription="Legacy Free-form Quantity",
        endDate=(date.today() + timedelta(days=45)).isoformat(),
    )
    license_row = await db_session.get(License, license_data["id"])
    license_row.quantity = "25 seats"
    await db_session.commit()

    resp = await test_app.get("/api/renewals/workbench", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    row = next(item for item in resp.json() if item["licenseId"] == license_data["id"])
    assert row["estimatedAnnualValue"] == 0.0
    assert isinstance(row["estimatedAnnualValue"], float)
    assert "invalid_numeric" in {flag["code"] for flag in row["riskFlags"]}

"""
Integration tests for department-scoped viewer access (H5a).

Tests 2p–2u cover:
  - Viewer scoping on GET /api/licenses
  - Viewer with no departments sees empty list
  - Admin sees all licenses unfiltered
  - Stats endpoint respects viewer scope
  - GET /api/licenses/departments returns distinct sorted values
  - PUT /api/users/{id}/departments saves and replaces
"""

import bcrypt

from app.models.document import Document, DocumentCategory
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess


# ---------------------------------------------------------------------------
# Helpers
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
    resp = await client.post("/api/licenses", json=_minimal_payload(**overrides), headers=headers)
    assert resp.status_code == 201, f"_create_license failed: {resp.text}"
    return resp.json()


async def _create_viewer(db_session, username: str, departments: list[str]) -> tuple[User, str]:
    """Create a viewer user with the given department assignments. Returns (user, password)."""
    password = f"viewerpass_{username}"
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

    for dept in departments:
        db_session.add(UserDepartmentAccess(user_id=viewer.id, department=dept))
    await db_session.commit()

    return viewer, password


async def _viewer_headers(test_app, username: str, password: str) -> dict:
    resp = await test_app.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"viewer login failed: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------------------------------------------------------------------------
# 2p — Viewer with assigned departments sees only scoped licenses
# ---------------------------------------------------------------------------

async def test_viewer_sees_only_assigned_department(db_session, test_app, auth_headers):
    it_lic = await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")
    hr_lic = await _create_license(test_app, auth_headers, costCentre="HR", softwareDescription="HR Tool")

    _, password = await _create_viewer(db_session, "viewer_2p", ["IT"])
    headers = await _viewer_headers(test_app, "viewer_2p", password)

    resp = await test_app.get("/api/licenses", headers=headers)
    assert resp.status_code == 200
    ids = [l["id"] for l in resp.json()]
    assert it_lic["id"] in ids
    assert hr_lic["id"] not in ids


async def test_viewer_cannot_get_license_outside_assigned_department(db_session, test_app, auth_headers):
    it_lic = await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")
    hr_lic = await _create_license(test_app, auth_headers, costCentre="HR", softwareDescription="HR Tool")

    _, password = await _create_viewer(db_session, "viewer_direct_license", ["IT"])
    headers = await _viewer_headers(test_app, "viewer_direct_license", password)

    allowed = await test_app.get(f"/api/licenses/{it_lic['id']}", headers=headers)
    denied = await test_app.get(f"/api/licenses/{hr_lic['id']}", headers=headers)

    assert allowed.status_code == 200
    assert denied.status_code == 404


async def test_viewer_cannot_list_documents_outside_assigned_department(db_session, test_app, auth_headers):
    it_lic = await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")
    hr_lic = await _create_license(test_app, auth_headers, costCentre="HR", softwareDescription="HR Tool")
    document = Document(
        license_id=hr_lic["id"],
        filename=f"documents/{hr_lic['id']}/hr.pdf",
        original_filename="hr.pdf",
        file_size=10,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()

    _, password = await _create_viewer(db_session, "viewer_direct_docs", ["IT"])
    headers = await _viewer_headers(test_app, "viewer_direct_docs", password)

    allowed = await test_app.get(f"/api/licenses/{it_lic['id']}/documents", headers=headers)
    denied = await test_app.get(f"/api/licenses/{hr_lic['id']}/documents", headers=headers)

    assert allowed.status_code == 200
    assert denied.status_code == 404


# ---------------------------------------------------------------------------
# 2q — Viewer with no departments sees zero licenses
# ---------------------------------------------------------------------------

async def test_viewer_no_departments_sees_nothing(db_session, test_app, auth_headers):
    await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")

    _, password = await _create_viewer(db_session, "viewer_2q", [])
    headers = await _viewer_headers(test_app, "viewer_2q", password)

    resp = await test_app.get("/api/licenses", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# 2r — Admin sees all licenses regardless of cost_centre
# ---------------------------------------------------------------------------

async def test_admin_sees_all_licenses(test_app, auth_headers):
    it_lic = await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")
    hr_lic = await _create_license(test_app, auth_headers, costCentre="HR", softwareDescription="HR Tool")

    resp = await test_app.get("/api/licenses", headers=auth_headers)
    assert resp.status_code == 200
    ids = [l["id"] for l in resp.json()]
    assert it_lic["id"] in ids
    assert hr_lic["id"] in ids


# ---------------------------------------------------------------------------
# 2s — Stats endpoint respects viewer department scope
# ---------------------------------------------------------------------------

async def test_stats_respects_viewer_scope(db_session, test_app, auth_headers):
    await _create_license(test_app, auth_headers, costCentre="IT", softwareDescription="IT Tool")
    await _create_license(test_app, auth_headers, costCentre="HR", softwareDescription="HR Tool")

    _, password = await _create_viewer(db_session, "viewer_2s", ["IT"])
    headers = await _viewer_headers(test_app, "viewer_2s", password)

    resp = await test_app.get("/api/licenses/stats", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1


# ---------------------------------------------------------------------------
# 2t — GET /api/licenses/departments returns distinct sorted values
# ---------------------------------------------------------------------------

async def test_list_departments_distinct_sorted(test_app, auth_headers):
    await _create_license(test_app, auth_headers, costCentre="HR")
    await _create_license(test_app, auth_headers, costCentre="IT")
    await _create_license(test_app, auth_headers, costCentre="IT")   # duplicate
    await _create_license(test_app, auth_headers)                     # no costCentre (null)

    resp = await test_app.get("/api/licenses/departments", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == ["HR", "IT"]


async def test_viewer_list_departments_respects_assigned_scope(db_session, test_app, auth_headers):
    await _create_license(test_app, auth_headers, costCentre="HR")
    await _create_license(test_app, auth_headers, costCentre="IT")

    _, password = await _create_viewer(db_session, "viewer_departments_it", ["IT"])
    headers = await _viewer_headers(test_app, "viewer_departments_it", password)

    resp = await test_app.get("/api/licenses/departments", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == ["IT"]


async def test_viewer_list_departments_without_assignments_returns_empty(db_session, test_app, auth_headers):
    await _create_license(test_app, auth_headers, costCentre="HR")
    await _create_license(test_app, auth_headers, costCentre="IT")

    _, password = await _create_viewer(db_session, "viewer_departments_empty", [])
    headers = await _viewer_headers(test_app, "viewer_departments_empty", password)

    resp = await test_app.get("/api/licenses/departments", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# 2u — PUT /api/users/{id}/departments saves and replaces
# ---------------------------------------------------------------------------

async def test_put_departments_saves_and_replaces(db_session, test_app, auth_headers):
    viewer, _ = await _create_viewer(db_session, "viewer_2u", ["IT"])

    # Replace with a new list
    resp = await test_app.put(
        f"/api/users/{viewer.id}/departments",
        json={"departments": ["HR", "Finance"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert sorted(resp.json()["departments"]) == ["Finance", "HR"]

    # Verify DB state
    result = await db_session.execute(
        __import__("sqlalchemy", fromlist=["select"]).select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == viewer.id)
    )
    saved = sorted([r[0] for r in result.all()])
    assert saved == ["Finance", "HR"]


async def test_put_departments_deduplicates_exact_duplicates(db_session, test_app, auth_headers):
    viewer, _ = await _create_viewer(db_session, "viewer_department_duplicates", [])

    resp = await test_app.put(
        f"/api/users/{viewer.id}/departments",
        json={"departments": ["IT", "IT", "HR", "IT"]},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["departments"] == ["IT", "HR"]

    result = await db_session.execute(
        __import__("sqlalchemy", fromlist=["select"]).select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == viewer.id)
    )
    saved = sorted([r[0] for r in result.all()])
    assert saved == ["HR", "IT"]


async def test_put_departments_keeps_different_casing_as_distinct(db_session, test_app, auth_headers):
    viewer, _ = await _create_viewer(db_session, "viewer_department_casing", [])

    resp = await test_app.put(
        f"/api/users/{viewer.id}/departments",
        json={"departments": ["ART", "art"]},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["departments"] == ["ART", "art"]

"""
Integration coverage for authentication and role authorization on high-risk API routes.

These tests intentionally exercise the real FastAPI dependency chain with real JWTs
and an isolated in-memory database. The route cases are representative rather than
exhaustive: they guard the common auth contract across read routes, editor mutation
routes, and admin-only surfaces.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import pytest

from app import auth
from app.models.user import User, UserRole
from app.services.settings_service import invalidate_global_settings_cache


@pytest.fixture(autouse=True)
def clear_settings_cache():
    invalidate_global_settings_cache()
    yield
    invalidate_global_settings_cache()


async def _create_role_headers(db_session, role: UserRole) -> dict[str, str]:
    user = User(
        username=f"{role.value}_authz",
        email=f"{role.value}_authz@test.local",
        hashed_password=auth.hash_password("testpassword123"),
        role=role,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = auth.create_access_token(user.id, user.role.value)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def role_headers(db_session) -> dict[UserRole, dict[str, str]]:
    return {
        UserRole.admin: await _create_role_headers(db_session, UserRole.admin),
        UserRole.editor: await _create_role_headers(db_session, UserRole.editor),
        UserRole.viewer: await _create_role_headers(db_session, UserRole.viewer),
    }


def _future_date(days: int = 365) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _license_payload(name: str = "Authz Suite") -> dict[str, Any]:
    return {
        "publisherName": "Acme",
        "softwareDescription": name,
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "10",
        "startDate": date.today().isoformat(),
        "endDate": _future_date(),
    }


def _csv_file() -> dict[str, tuple[str, bytes, str]]:
    csv_bytes = (
        b"Publisher,Description,End Date\n"
        + f"Acme,Imported Suite,{_future_date()}\n".encode("utf-8")
    )
    return {"file": ("licenses.csv", csv_bytes, "text/csv")}


@dataclass(frozen=True)
class RouteCase:
    method: str
    path: str
    kwargs_factory: Callable[[], dict[str, Any]] = lambda: {}


async def _send(test_app, case: RouteCase, headers: dict[str, str] | None = None):
    kwargs = case.kwargs_factory()
    if headers is not None:
        kwargs["headers"] = headers
    return await test_app.request(case.method, case.path, **kwargs)


UNAUTHENTICATED_READ_ROUTES = [
    RouteCase("GET", "/api/licenses"),
    RouteCase("GET", "/api/users"),
    RouteCase("GET", "/api/settings/global"),
    RouteCase("GET", "/api/backup/list"),
    RouteCase("GET", "/api/contracts"),
    RouteCase("GET", "/api/licenses/1/documents"),
    RouteCase("GET", "/api/sourcing"),
    RouteCase("GET", "/api/pending-orders"),
    RouteCase("GET", "/api/audit-log"),
    RouteCase("GET", "/api/import/mappings"),
]


VIEWER_DENIED_MUTATION_ROUTES = [
    RouteCase("POST", "/api/licenses", lambda: {"json": _license_payload()}),
    RouteCase("POST", "/api/contracts", lambda: {"json": {"contract_number": "C-1", "publisher_name": "Acme"}}),
    RouteCase(
        "POST",
        "/api/licenses/999/documents",
        lambda: {"files": {"file": ("invoice.pdf", b"%PDF-1.4\n", "application/pdf")}, "data": {"category": "invoice"}},
    ),
    RouteCase("POST", "/api/sourcing", lambda: {"json": {"publisherName": "Acme", "softwareDescription": "Sourcing Suite"}}),
    RouteCase("POST", "/api/pending-orders", lambda: {"json": {"poNumber": "PO-1", "supplier": "Acme"}}),
    RouteCase("POST", "/api/import/preview", lambda: {"files": _csv_file()}),
]


VIEWER_DENIED_PROCUREMENT_READ_ROUTES = [
    RouteCase("GET", "/api/sourcing"),
    RouteCase("GET", "/api/sourcing/999999"),
    RouteCase("GET", "/api/sourcing/export"),
    RouteCase("GET", "/api/sourcing/requests"),
    RouteCase("GET", "/api/sourcing/requests/999999"),
    RouteCase("GET", "/api/sourcing/requests/999999/quote-documents"),
    RouteCase("GET", "/api/sourcing/quote-documents/999999/download"),
    RouteCase("GET", "/api/pending-orders"),
    RouteCase("GET", "/api/pending-orders/999999"),
    RouteCase("GET", "/api/pending-orders/export"),
    RouteCase("GET", "/api/pending-orders/999999/documents"),
    RouteCase("GET", "/api/pending-orders/documents/999999/download"),
]


EDITOR_ALLOWED_MUTATION_ROUTES = [
    RouteCase("POST", "/api/licenses", lambda: {"json": _license_payload("Editor License")}),
    RouteCase("POST", "/api/contracts", lambda: {"json": {"contract_number": "C-EDITOR", "publisher_name": "Acme"}}),
    RouteCase(
        "POST",
        "/api/licenses/999/documents",
        lambda: {"files": {"file": ("invoice.pdf", b"%PDF-1.4\n", "application/pdf")}, "data": {"category": "invoice"}},
    ),
    RouteCase("POST", "/api/sourcing", lambda: {"json": {"publisherName": "Acme", "softwareDescription": "Editor Sourcing"}}),
    RouteCase("POST", "/api/pending-orders", lambda: {"json": {"poNumber": "PO-EDITOR", "supplier": "Acme"}}),
    RouteCase("POST", "/api/import/preview", lambda: {"files": _csv_file()}),
    RouteCase("PUT", "/api/settings", lambda: {"json": {"notification_days": 45}}),
]


ADMIN_ONLY_ROUTES = [
    RouteCase("GET", "/api/users"),
    RouteCase("POST", "/api/users", lambda: {"json": {
        "username": "new_admin_only_user",
        "email": "new_admin_only_user@test.local",
        "password": "testpassword123",
        "role": "viewer",
    }}),
    RouteCase("GET", "/api/settings/global"),
    RouteCase("PUT", "/api/settings/global", lambda: {"json": {"notification_days": 60}}),
    RouteCase("GET", "/api/backup/list"),
    RouteCase("GET", "/api/audit-log"),
    RouteCase("POST", "/api/import/mappings", lambda: {"json": {
        "name": "Admin Mapping",
        "mapping": [{"rawHeader": "Publisher", "target": "publisher_name"}],
    }}),
]


@pytest.mark.parametrize("case", UNAUTHENTICATED_READ_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_unauthenticated_requests_are_rejected(test_app, case: RouteCase):
    response = await _send(test_app, case)

    assert response.status_code == 401


@pytest.mark.parametrize("case", VIEWER_DENIED_MUTATION_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_viewers_are_denied_mutation_routes(test_app, role_headers, case: RouteCase):
    response = await _send(test_app, case, role_headers[UserRole.viewer])

    assert response.status_code == 403


@pytest.mark.parametrize("case", VIEWER_DENIED_PROCUREMENT_READ_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_viewers_are_denied_procurement_read_routes(test_app, role_headers, case: RouteCase):
    response = await _send(test_app, case, role_headers[UserRole.viewer])

    assert response.status_code == 403


@pytest.mark.parametrize("case", VIEWER_DENIED_PROCUREMENT_READ_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_editors_can_reach_procurement_read_routes(test_app, role_headers, case: RouteCase):
    response = await _send(test_app, case, role_headers[UserRole.editor])

    assert response.status_code not in (401, 403), response.text


@pytest.mark.parametrize("case", EDITOR_ALLOWED_MUTATION_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_editors_can_reach_allowed_mutation_routes(test_app, role_headers, case: RouteCase):
    response = await _send(test_app, case, role_headers[UserRole.editor])

    assert response.status_code not in (401, 403), response.text


@pytest.mark.parametrize("case", ADMIN_ONLY_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_admin_only_routes_reject_viewers_and_editors(test_app, role_headers, case: RouteCase):
    viewer_response = await _send(test_app, case, role_headers[UserRole.viewer])
    editor_response = await _send(test_app, case, role_headers[UserRole.editor])

    assert viewer_response.status_code == 403
    assert editor_response.status_code == 403


@pytest.mark.parametrize("case", ADMIN_ONLY_ROUTES, ids=lambda case: f"{case.method} {case.path}")
async def test_admins_can_reach_admin_only_routes(test_app, role_headers, case: RouteCase):
    response = await _send(test_app, case, role_headers[UserRole.admin])

    assert response.status_code not in (401, 403), response.text


async def test_editors_can_execute_import_and_read_but_cannot_manage_saved_mappings(test_app, role_headers):
    mapping_json = json.dumps({
        "mapping": [
            {"rawHeader": "Publisher", "target": "publisher_name"},
            {"rawHeader": "Description", "target": "software_description"},
            {"rawHeader": "End Date", "target": "end_date"},
        ]
    })

    execute_response = await test_app.post(
        "/api/import/execute",
        headers=role_headers[UserRole.editor],
        files=_csv_file(),
        data={"mapping_json": mapping_json},
    )
    mappings_response = await test_app.get(
        "/api/import/mappings",
        headers=role_headers[UserRole.editor],
    )
    create_mapping_response = await test_app.post(
        "/api/import/mappings",
        headers=role_headers[UserRole.editor],
        json={
            "name": "Editor Mapping",
            "mapping": [{"rawHeader": "Publisher", "target": "publisher_name"}],
        },
    )
    named_execute_response = await test_app.post(
        "/api/import/execute",
        headers=role_headers[UserRole.editor],
        files=_csv_file(),
        data={"mapping_json": json.dumps({
            "mapping": json.loads(mapping_json)["mapping"],
            "mappingName": "Editor Mapping",
        })},
    )

    assert execute_response.status_code == 200
    assert mappings_response.status_code == 200
    assert create_mapping_response.status_code == 403
    assert named_execute_response.status_code == 403

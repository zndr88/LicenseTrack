"""A locked SQLite database answers 503 + Retry-After; other database errors stay 500."""

import sqlite3

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from app.main import app

TEST_PATH = "/api/__test_database_error"


def _operational_error(message: str) -> OperationalError:
    return OperationalError("INSERT INTO licenses ...", {}, sqlite3.OperationalError(message))


@pytest.fixture
async def raising_client():
    errors: dict[str, Exception] = {}

    async def raise_configured_error():
        raise errors["next"]

    app.add_api_route(TEST_PATH, raise_configured_error, methods=["GET"])
    # Ahead of the SPA catch-all so it is matched first.
    app.router.routes.insert(0, app.router.routes.pop())
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            headers={"X-LicenseTrack-Request": "1"},
        ) as client:
            yield client, errors
    finally:
        app.router.routes[:] = [route for route in app.router.routes if getattr(route, "path", None) != TEST_PATH]


async def test_locked_database_returns_503_with_retry_after(raising_client):
    client, errors = raising_client
    errors["next"] = _operational_error("database is locked")
    response = await client.get(TEST_PATH)
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    assert response.json() == {"detail": "The database is busy. Retry the request shortly."}


async def test_other_operational_errors_stay_500(raising_client):
    client, errors = raising_client
    errors["next"] = _operational_error("no such table: licenses")
    response = await client.get(TEST_PATH)
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}

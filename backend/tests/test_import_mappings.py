"""
Integration tests for import mapping CRUD and the /execute endpoint.

Covers:
- GET /api/import/mappings — empty list, then populated
- POST /api/import/mappings — create, duplicate 409
- PUT /api/import/mappings/{id} — update name, 404, 409 conflict
- DELETE /api/import/mappings/{id} — 204, 404
- POST /api/import/execute — valid CSV, skip targets, mapping_name save
- POST /api/import/flexera/preview — endpoint removed (404)
"""

from __future__ import annotations

import csv
import io
import json
from datetime import date, timedelta

from sqlalchemy import select

from app.models.license import License


_FUTURE = (date.today() + timedelta(days=365)).isoformat()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_csv(headers: list[str], rows: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore", restval="")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _mapping_payload(
    name: str,
    entries: list[dict],
) -> dict:
    return {
        "name": name,
        "mapping": entries,
    }


# ---------------------------------------------------------------------------
# Mapping CRUD
# ---------------------------------------------------------------------------

async def test_list_mappings_empty(test_app, auth_headers):
    resp = await test_app.get("/api/import/mappings", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_mapping_success(test_app, auth_headers):
    payload = _mapping_payload(
        "My Mapping",
        [{"rawHeader": "Publisher", "target": "publisher_name"}],
    )
    resp = await test_app.post("/api/import/mappings", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Mapping"
    assert data["id"] > 0
    assert len(data["mapping"]) == 1
    assert data["mapping"][0]["rawHeader"] == "Publisher"
    assert data["mapping"][0]["target"] == "publisher_name"
    assert "createdAt" in data
    assert "updatedAt" in data


async def test_create_mapping_duplicate_name_409(test_app, auth_headers):
    payload = _mapping_payload("Dup Mapping", [{"rawHeader": "A", "target": "publisher_name"}])
    resp1 = await test_app.post("/api/import/mappings", json=payload, headers=auth_headers)
    assert resp1.status_code == 201

    resp2 = await test_app.post("/api/import/mappings", json=payload, headers=auth_headers)
    assert resp2.status_code == 409


async def test_list_mappings_after_create(test_app, auth_headers):
    await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("Beta", [{"rawHeader": "X", "target": "skip"}]),
        headers=auth_headers,
    )
    await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("Alpha", [{"rawHeader": "Y", "target": "skip"}]),
        headers=auth_headers,
    )
    resp = await test_app.get("/api/import/mappings", headers=auth_headers)
    assert resp.status_code == 200
    names = [m["name"] for m in resp.json()]
    assert names == ["Alpha", "Beta"]  # ordered ascending


async def test_update_mapping_success(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("Old Name", [{"rawHeader": "A", "target": "publisher_name"}]),
        headers=auth_headers,
    )
    mapping_id = create_resp.json()["id"]

    update_resp = await test_app.put(
        f"/api/import/mappings/{mapping_id}",
        json=_mapping_payload(
            "New Name",
            [{"rawHeader": "B", "target": "software_description"}],
        ),
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["name"] == "New Name"
    assert data["mapping"][0]["rawHeader"] == "B"


async def test_update_mapping_not_found(test_app, auth_headers):
    resp = await test_app.put(
        "/api/import/mappings/99999",
        json=_mapping_payload("X", [{"rawHeader": "A", "target": "skip"}]),
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_update_mapping_name_conflict(test_app, auth_headers):
    await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("First", [{"rawHeader": "A", "target": "skip"}]),
        headers=auth_headers,
    )
    r2 = await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("Second", [{"rawHeader": "B", "target": "skip"}]),
        headers=auth_headers,
    )
    mapping_id = r2.json()["id"]

    resp = await test_app.put(
        f"/api/import/mappings/{mapping_id}",
        json=_mapping_payload("First", [{"rawHeader": "B", "target": "skip"}]),
        headers=auth_headers,
    )
    assert resp.status_code == 409


async def test_delete_mapping_success(test_app, auth_headers):
    create_resp = await test_app.post(
        "/api/import/mappings",
        json=_mapping_payload("To Delete", [{"rawHeader": "A", "target": "skip"}]),
        headers=auth_headers,
    )
    mapping_id = create_resp.json()["id"]

    del_resp = await test_app.delete(
        f"/api/import/mappings/{mapping_id}", headers=auth_headers
    )
    assert del_resp.status_code == 204
    assert del_resp.content == b""

    list_resp = await test_app.get("/api/import/mappings", headers=auth_headers)
    assert list_resp.json() == []


async def test_delete_mapping_not_found(test_app, auth_headers):
    resp = await test_app.delete("/api/import/mappings/99999", headers=auth_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Execute endpoint
# ---------------------------------------------------------------------------

def _simple_csv() -> bytes:
    return _make_csv(
        ["Publisher", "Description", "End Date"],
        [
            {"Publisher": "Acme Corp", "Description": "Widget", "End Date": _FUTURE},
            {"Publisher": "Beta Ltd", "Description": "Gadget", "End Date": _FUTURE},
        ],
    )


def _simple_mapping() -> list[dict]:
    return [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "End Date", "target": "end_date"},
    ]


async def test_execute_import_valid_csv(test_app, auth_headers):
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", _simple_csv(), "text/csv")},
        data={"mapping_json": json.dumps({"mapping": _simple_mapping()})},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 2
    assert data["skippedCount"] == 0
    assert data["errorCount"] == 0


async def test_execute_import_parses_declared_belgian_locale(
    test_app, db_session, auth_headers
):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Start", "Qty", "Price"],
        [{
            "Publisher": "Acme",
            "Description": "Mapped Belgian Suite",
            "Start": "01/02/2027",
            "Qty": "1.000",
            "Price": "1.234,50",
        }],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Start", "target": "start_date"},
        {"rawHeader": "Qty", "target": "quantity"},
        {"rawHeader": "Price", "target": "unit_price"},
    ]

    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", csv_bytes, "text/csv")},
        data={
            "mapping_json": json.dumps({"mapping": mapping}),
            "number_format_locale": "nl-BE",
            "date_format": "DD/MM/YYYY",
        },
    )

    assert resp.status_code == 200, resp.text
    license_obj = await db_session.scalar(
        select(License).where(License.software_description == "Mapped Belgian Suite")
    )
    assert license_obj is not None
    assert license_obj.start_date == date(2027, 2, 1)
    assert license_obj.quantity == "1000"
    assert license_obj.unit_price == "1234.50"


async def test_execute_import_skip_target_ignored(test_app, auth_headers):
    csv_bytes = _make_csv(
        ["Publisher", "Description", "Secret Column"],
        [{"Publisher": "Acme", "Description": "Widget", "Secret Column": "sensitive"}],
    )
    mapping = [
        {"rawHeader": "Publisher", "target": "publisher_name"},
        {"rawHeader": "Description", "target": "software_description"},
        {"rawHeader": "Secret Column", "target": "skip"},
    ]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )
    assert resp.status_code == 200
    assert resp.json()["importedCount"] == 1


async def test_execute_import_saves_mapping_name(test_app, auth_headers):
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", _simple_csv(), "text/csv")},
        data={
            "mapping_json": json.dumps(
                {"mapping": _simple_mapping(), "mappingName": "Auto Saved"}
            )
        },
    )
    assert resp.status_code == 200

    # Verify mapping was saved
    list_resp = await test_app.get("/api/import/mappings", headers=auth_headers)
    names = [m["name"] for m in list_resp.json()]
    assert "Auto Saved" in names


async def test_execute_import_upserts_existing_mapping(test_app, auth_headers):
    # First execute — creates mapping
    await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", _simple_csv(), "text/csv")},
        data={"mapping_json": json.dumps({"mapping": _simple_mapping(), "mappingName": "Upsert Me"})},
    )

    # Second execute with same name — should update, not 409
    new_mapping = [{"rawHeader": "Publisher", "target": "publisher_name"}]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", _simple_csv(), "text/csv")},
        data={"mapping_json": json.dumps({"mapping": new_mapping, "mappingName": "Upsert Me"})},
    )
    assert resp.status_code == 200

    # Only one mapping with that name
    list_resp = await test_app.get("/api/import/mappings", headers=auth_headers)
    upsert_entries = [m for m in list_resp.json() if m["name"] == "Upsert Me"]
    assert len(upsert_entries) == 1


async def test_execute_import_missing_required_fields_error(test_app, auth_headers):
    # CSV with no publisher or description → all rows error
    csv_bytes = _make_csv(["Notes"], [{"Notes": "some note"}])
    mapping = [{"rawHeader": "Notes", "target": "notes"}]
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", csv_bytes, "text/csv")},
        data={"mapping_json": json.dumps({"mapping": mapping})},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["importedCount"] == 0
    assert data["skippedCount"] == 1
    assert data["errorCount"] == 1


async def test_execute_import_invalid_mapping_json(test_app, auth_headers):
    resp = await test_app.post(
        "/api/import/execute",
        headers=auth_headers,
        files={"file": ("data.csv", _simple_csv(), "text/csv")},
        data={"mapping_json": "not valid json"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Flexera endpoints removed
# ---------------------------------------------------------------------------

async def test_flexera_preview_endpoint_removed(test_app, auth_headers):
    """POST /api/import/flexera/preview should no longer exist."""
    csv_bytes = _make_csv(["Publisher", "Description"], [{"Publisher": "A", "Description": "B"}])
    resp = await test_app.post(
        "/api/import/flexera/preview",
        headers=auth_headers,
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert resp.status_code in (404, 405)

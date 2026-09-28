import csv
import io
from datetime import date, timedelta

from sqlalchemy import select

from app.models.license import License, LicenseCoverageHistory
from app.services.maintenance_service import hand_over_due_maintenance


def _payload(**overrides) -> dict:
    payload = {
        "publisherName": "Acme Corp",
        "softwareDescription": "Acme Suite",
        "licenseType": "perpetual",
        "licenseMetric": "per_user",
        "quantity": "1",
        "currency": "EUR",
    }
    payload.update(overrides)
    return payload


async def _create_license(test_app, auth_headers, **overrides) -> dict:
    response = await test_app.post(
        "/api/licenses",
        json=_payload(**overrides),
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _create_parent_with_current_maintenance(test_app, auth_headers, *, suffix: str) -> tuple[dict, dict]:
    today = date.today()
    parent = await _create_license(
        test_app,
        auth_headers,
        softwareDescription=f"Parent {suffix}",
    )
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        softwareDescription=f"Current Maintenance {suffix}",
        startDate=(today - timedelta(days=30)).isoformat(),
        endDate=(today + timedelta(days=180)).isoformat(),
    )
    return parent, maintenance


async def test_linking_future_maintenance_keeps_current_record(test_app, auth_headers):
    today = date.today()
    parent, current = await _create_parent_with_current_maintenance(test_app, auth_headers, suffix="future")
    other_parent = await _create_license(test_app, auth_headers, softwareDescription="Other Future Parent")
    future = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=other_parent["id"],
        softwareDescription="Future Maintenance",
        startDate=(today + timedelta(days=181)).isoformat(),
        endDate=(today + timedelta(days=545)).isoformat(),
    )

    response = await test_app.post(
        f"/api/licenses/{parent['id']}/link-maintenance",
        json={"maintenanceLicenseId": future["id"]},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["activeMaintenanceId"] == current["id"]


async def test_linking_ended_maintenance_keeps_current_record(test_app, auth_headers):
    today = date.today()
    parent, current = await _create_parent_with_current_maintenance(test_app, auth_headers, suffix="ended")
    other_parent = await _create_license(test_app, auth_headers, softwareDescription="Other Ended Parent")
    ended = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=other_parent["id"],
        softwareDescription="Ended Maintenance",
        startDate=(today - timedelta(days=730)).isoformat(),
        endDate=(today - timedelta(days=366)).isoformat(),
    )

    response = await test_app.post(
        f"/api/licenses/{parent['id']}/link-maintenance",
        json={"maintenanceLicenseId": ended["id"]},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["activeMaintenanceId"] == current["id"]


async def test_importing_historical_maintenance_keeps_current_record(test_app, auth_headers):
    today = date.today()
    parent, current = await _create_parent_with_current_maintenance(test_app, auth_headers, suffix="import")
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "publisher_name",
            "software_description",
            "license_type",
            "parent_license_ref",
            "start_date",
            "end_date",
        ],
    )
    writer.writeheader()
    writer.writerow(
        {
            "publisher_name": "Acme Corp",
            "software_description": "Historical Maintenance",
            "license_type": "maintenance",
            "parent_license_ref": parent["licenseRef"],
            "start_date": (today - timedelta(days=730)).isoformat(),
            "end_date": (today - timedelta(days=366)).isoformat(),
        }
    )

    imported = await test_app.post(
        "/api/import/confirm",
        headers=auth_headers,
        files={"file": ("historical.csv", output.getvalue().encode(), "text/csv")},
    )

    assert imported.status_code == 200, imported.text
    assert imported.json()["importedCount"] == 1
    refreshed = await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)
    assert refreshed.json()["activeMaintenanceId"] == current["id"]


async def test_daily_handover_recomputes_active_record_and_snapshots_history(
    test_app,
    auth_headers,
    db_session,
):
    today = date.today()
    parent, current = await _create_parent_with_current_maintenance(test_app, auth_headers, suffix="handover")
    successor_start = today + timedelta(days=181)
    successor = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        softwareDescription="Successor Maintenance",
        startDate=successor_start.isoformat(),
        endDate=(successor_start + timedelta(days=364)).isoformat(),
    )

    assert await hand_over_due_maintenance(db_session, today=successor_start) == 1

    parent_row = await db_session.get(License, parent["id"])
    await db_session.refresh(parent_row)
    assert parent_row.active_maintenance_id == successor["id"]
    history = list(
        (
            await db_session.execute(
                select(LicenseCoverageHistory).where(
                    LicenseCoverageHistory.parent_license_id == parent["id"],
                    LicenseCoverageHistory.maintenance_license_id == current["id"],
                )
            )
        ).scalars()
    )
    assert len(history) == 1

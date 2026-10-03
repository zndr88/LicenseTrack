import csv
import io
from datetime import date, timedelta

from sqlalchemy import select

from app.models.license import License, LicenseCoverageHistory
from app.services.maintenance_service import hand_over_due_maintenance, sync_parent_mirror_fields


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
        data={"acknowledge_warnings": "true"},
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


async def test_disable_maintenance_removes_active_and_future_terms(
    test_app,
    auth_headers,
    db_session,
):
    today = date.today()
    parent, _current = await _create_parent_with_current_maintenance(test_app, auth_headers, suffix="disable")
    future_start = today + timedelta(days=181)
    await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        softwareDescription="Planned Maintenance",
        startDate=future_start.isoformat(),
        endDate=(future_start + timedelta(days=364)).isoformat(),
    )

    disabled = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        headers=auth_headers,
    )

    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["activeMaintenanceId"] is None
    assert disabled.json()["linkedMaintenanceIds"] == []
    assert disabled.json()["hasMaintenance"] is False
    assert await hand_over_due_maintenance(db_session, today=future_start) == 0
    refreshed = await test_app.get(f"/api/licenses/{parent['id']}", headers=auth_headers)
    assert refreshed.json()["activeMaintenanceId"] is None
    assert refreshed.json()["hasMaintenance"] is False


async def test_disable_maintenance_unlinks_future_term_when_no_record_is_active(
    test_app,
    auth_headers,
    db_session,
):
    today = date.today()
    parent = await _create_license(test_app, auth_headers, softwareDescription="Future-only Parent")
    future = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        softwareDescription="Future-only Maintenance",
        startDate=(today + timedelta(days=30)).isoformat(),
        endDate=(today + timedelta(days=394)).isoformat(),
    )
    parent_row = await db_session.get(License, parent["id"])
    parent_row.active_maintenance_id = None
    await sync_parent_mirror_fields(db_session, parent_row)
    await db_session.commit()

    disabled = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        headers=auth_headers,
    )

    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["activeMaintenanceId"] is None
    assert disabled.json()["linkedMaintenanceIds"] == []
    future_row = await db_session.get(License, future["id"])
    await db_session.refresh(future_row)
    assert future_row.is_retired is True


async def test_disable_maintenance_history_uses_the_line_total(
    test_app,
    auth_headers,
    db_session,
):
    today = date.today()
    parent = await _create_license(test_app, auth_headers, softwareDescription="Cost Parent")
    maintenance = await _create_license(
        test_app,
        auth_headers,
        licenseType="maintenance",
        parentLicenseId=parent["id"],
        softwareDescription="Cost Maintenance",
        quantity="2",
        unitPrice="50",
        startDate=(today - timedelta(days=30)).isoformat(),
        endDate=(today + timedelta(days=180)).isoformat(),
    )
    maintenance_row = await db_session.get(License, maintenance["id"])
    maintenance_row.maintenance_cost = "999"
    await db_session.commit()

    disabled = await test_app.post(
        f"/api/licenses/{parent['id']}/disable-maintenance",
        headers=auth_headers,
    )

    assert disabled.status_code == 200, disabled.text
    history = await db_session.scalar(
        select(LicenseCoverageHistory).where(
            LicenseCoverageHistory.parent_license_id == parent["id"],
            LicenseCoverageHistory.maintenance_license_id == maintenance["id"],
        )
    )
    assert history.cost == "100"

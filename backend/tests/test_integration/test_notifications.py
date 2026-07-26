from datetime import date, timedelta

import bcrypt

from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder
from app.models.settings import GlobalSettings
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess
from app.services.settings_service import invalidate_global_settings_cache


async def _create_viewer(db_session, username: str, departments: list[str]) -> dict:
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

    for department in departments:
        db_session.add(UserDepartmentAccess(user_id=viewer.id, department=department))
    await db_session.commit()

    return {"username": username, "password": password, "id": viewer.id}


async def _login(test_app, username: str, password: str) -> dict:
    response = await test_app.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _license(**overrides) -> License:
    values = {
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "10",
        "currency": "EUR",
        "cost_centre": "IT",
        "is_retired": False,
    }
    values.update(overrides)
    return License(**values)


async def test_notifications_include_upcoming_and_expired_license_rows(
    db_session, test_app, auth_headers
):
    upcoming = _license(
        software_description="Upcoming Suite",
        end_date=date.today() + timedelta(days=12),
    )
    expired = _license(
        software_description="Expired Suite",
        end_date=date.today() - timedelta(days=3),
    )
    db_session.add_all([upcoming, expired])
    await db_session.commit()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    rows = response.json()
    by_name = {(row["software_name"], row["type"]) for row in rows}
    assert ("Upcoming Suite", "expiring") in by_name
    assert ("Expired Suite", "expired") in by_name


async def test_notifications_exclude_future_start_from_expiration_alerts(
    db_session, test_app, auth_headers
):
    future_start = _license(
        software_description="Future Contract Year",
        start_date=date.today() + timedelta(days=30),
        end_date=date.today() + timedelta(days=45),
    )
    db_session.add(future_start)
    await db_session.commit()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    expiration_rows = {
        row["software_name"] for row in response.json() if row["type"] in {"expiring", "expired"}
    }
    assert "Future Contract Year" not in expiration_rows


async def test_notifications_respect_notification_day_setting(
    db_session, test_app, auth_headers
):
    db_session.add(GlobalSettings(id=1, notification_days=10))
    inside_window = _license(
        software_description="Inside Window",
        end_date=date.today() + timedelta(days=10),
    )
    outside_window = _license(
        software_description="Outside Window",
        end_date=date.today() + timedelta(days=11),
    )
    db_session.add_all([inside_window, outside_window])
    await db_session.commit()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    expiring_names = {
        row["software_name"] for row in response.json() if row["type"] == "expiring"
    }
    assert "Inside Window" in expiring_names
    assert "Outside Window" not in expiring_names


async def test_notifications_include_notice_deadlines_with_configured_window(
    db_session, test_app, auth_headers
):
    db_session.add(GlobalSettings(id=1, notice_notification_days=7))
    inside_window = _license(
        software_description="Notice Inside Window",
        notice_date=date.today() + timedelta(days=7),
    )
    outside_window = _license(
        software_description="Notice Outside Window",
        notice_date=date.today() + timedelta(days=8),
    )
    db_session.add_all([inside_window, outside_window])
    await db_session.commit()
    invalidate_global_settings_cache()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    notice_names = {
        row["software_name"] for row in response.json() if row["type"] == "notice_due"
    }
    assert "Notice Inside Window" in notice_names
    assert "Notice Outside Window" not in notice_names


async def test_notifications_exclude_legacy_renewed_retired_and_exempt_records(
    db_session, test_app, auth_headers
):
    db_session.add(
        GlobalSettings(
            id=1,
            mandatory_fields={
                "license": ["publisher_name", "software_description", "po_number"]
            },
        )
    )
    included = _license(
        software_description="Included Expired",
        end_date=date.today() - timedelta(days=1),
    )
    legacy = _license(
        software_description="Legacy Expired",
        end_date=date.today() - timedelta(days=1),
        lifecycle_status="legacy",
    )
    renewed = _license(
        software_description="Renewed Expired",
        end_date=date.today() - timedelta(days=1),
        lifecycle_status="renewed",
    )
    retired = _license(
        software_description="Retired Expired",
        end_date=date.today() - timedelta(days=1),
        is_retired=True,
    )
    exempt = _license(
        software_description="Exempt Incomplete",
        end_date=None,
        is_completeness_exempt=True,
    )
    db_session.add_all([included, legacy, renewed, retired, exempt])
    await db_session.commit()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    names = {row["software_name"] for row in response.json()}
    assert "Included Expired" in names
    assert "Legacy Expired" not in names
    assert "Renewed Expired" not in names
    assert "Retired Expired" not in names
    assert "Exempt Incomplete" not in names


async def test_notifications_count_procurement_documents_for_completeness(
    db_session, test_app, auth_headers
):
    db_session.add(GlobalSettings(id=1, mandatory_fields={"invoice": True}))
    order = PendingOrder(po_number="PO-NOTIFY")
    db_session.add(order)
    await db_session.flush()
    license_obj = _license(
        software_description="Invoice Complete",
        end_date=date.today() + timedelta(days=180),
        pending_order_id=order.id,
    )
    db_session.add(license_obj)
    await db_session.flush()
    db_session.add(
        ProcurementDocument(
            po_number=order.po_number,
            pending_order_id=order.id,
            filename="procurement/invoice.pdf",
            original_filename="invoice.pdf",
            file_size=10,
            mime_type="application/pdf",
            category=ProcurementDocumentCategory.invoice,
        )
    )
    await db_session.commit()

    response = await test_app.get("/api/notifications", headers=auth_headers)

    assert response.status_code == 200
    rows = response.json()
    assert not [
        row for row in rows
        if row["software_name"] == "Invoice Complete" and row["type"] == "incomplete"
    ]


async def test_notification_visibility_respects_viewer_department_filter(
    db_session, test_app, auth_headers
):
    it_license = _license(
        software_description="IT Renewal",
        cost_centre="IT",
        end_date=date.today() + timedelta(days=5),
    )
    hr_license = _license(
        software_description="HR Renewal",
        cost_centre="HR",
        end_date=date.today() + timedelta(days=5),
    )
    db_session.add_all([it_license, hr_license])
    await db_session.commit()

    viewer = await _create_viewer(db_session, "notifications_viewer", ["IT"])
    viewer_headers = await _login(test_app, viewer["username"], viewer["password"])

    response = await test_app.get("/api/notifications", headers=viewer_headers)

    assert response.status_code == 200
    names = {row["software_name"] for row in response.json()}
    assert "IT Renewal" in names
    assert "HR Renewal" not in names


async def test_notification_viewer_without_departments_sees_no_rows(
    db_session, test_app, auth_headers
):
    db_session.add(
        _license(
            software_description="Scoped Out Renewal",
            cost_centre="IT",
            end_date=date.today() + timedelta(days=5),
        )
    )
    await db_session.commit()

    viewer = await _create_viewer(db_session, "notifications_empty_viewer", [])
    viewer_headers = await _login(test_app, viewer["username"], viewer["password"])

    response = await test_app.get("/api/notifications", headers=viewer_headers)

    assert response.status_code == 200
    assert response.json() == []

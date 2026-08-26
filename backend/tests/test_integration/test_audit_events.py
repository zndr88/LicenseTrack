"""
Integration tests for audit log event coverage.

Each test makes a real HTTP call via test_app and then queries
the AuditLog table via db_session to confirm the correct event
row was created.
"""

import pytest
import bcrypt
from datetime import date, timedelta
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.license import License, LicenseType, LicenseMetric
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.pending_order import PendingOrder
from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def get_audit_rows(db_session, action: str):
    """Return all AuditLog rows matching the given action."""
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == action)
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def seeded_license(db_session):
    lic = License(
        publisher_name="Test Publisher",
        software_description="Test Software",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=90),
        currency="EUR",
        budget_owner_email="owner@example.com",
    )
    db_session.add(lic)
    await db_session.commit()
    await db_session.refresh(lic)
    return lic


@pytest.fixture
async def seeded_sourcing_item(db_session):
    item = SourcingItem(
        publisher_name="Test Publisher",
        software_description="Test Software",
        status=SourcingStatus.sourcing,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


@pytest.fixture
async def seeded_pending_order(db_session):
    order = PendingOrder(
        po_number="PO-TEST-001",
        supplier="Test Supplier",
    )
    db_session.add(order)
    await db_session.commit()
    await db_session.refresh(order)
    return order


# ---------------------------------------------------------------------------
# 1 — license.renewal_initiated
# ---------------------------------------------------------------------------

async def test_audit_license_renewal_initiated(
    test_app, db_session, auth_headers, seeded_license
):
    resp = await test_app.post(
        f"/api/licenses/{seeded_license.id}/initiate-renewal",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "license.renewal_initiated")
    assert len(rows) == 1
    assert rows[0].target_id == str(seeded_license.id)


# ---------------------------------------------------------------------------
# 2 — license renewal cancellation stays scoped to its sourcing line
# ---------------------------------------------------------------------------

async def test_audit_license_renewal_cancelled_does_not_log_whole_request_cancellation(
    test_app, db_session, auth_headers, seeded_license
):
    # First initiate so cancel has something to cancel
    await test_app.post(
        f"/api/licenses/{seeded_license.id}/initiate-renewal",
        headers=auth_headers,
    )
    resp = await test_app.post(
        f"/api/licenses/{seeded_license.id}/cancel-renewal",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "sourcing_request.cancelled")
    assert rows == []


# ---------------------------------------------------------------------------
# 3 — user.deleted
# ---------------------------------------------------------------------------

async def test_audit_user_deleted(
    test_app, db_session, auth_headers
):
    # Create a non-admin user to delete
    hashed = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode()
    user = User(
        username="todelete",
        email="todelete@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.delete(
        f"/api/users/{user.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204
    rows = await get_audit_rows(db_session, "user.deleted")
    assert len(rows) == 1
    assert rows[0].target_label == "todelete@test.local"


# ---------------------------------------------------------------------------
# 4 — sourcing.updated
# ---------------------------------------------------------------------------

async def test_audit_sourcing_updated(
    test_app, db_session, auth_headers, seeded_sourcing_item
):
    resp = await test_app.put(
        f"/api/sourcing/{seeded_sourcing_item.id}",
        headers=auth_headers,
        json={"software_description": "Updated Description"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "sourcing.updated")
    assert len(rows) == 1
    assert rows[0].target_id == str(seeded_sourcing_item.id)


# ---------------------------------------------------------------------------
# 5 — sourcing.deleted
# ---------------------------------------------------------------------------

async def test_audit_sourcing_deleted(
    test_app, db_session, auth_headers, seeded_sourcing_item
):
    resp = await test_app.delete(
        f"/api/sourcing/{seeded_sourcing_item.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204
    rows = await get_audit_rows(db_session, "sourcing.deleted")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 6 — sourcing.merged
# ---------------------------------------------------------------------------

async def test_audit_sourcing_merged(
    test_app, db_session, auth_headers, seeded_license
):
    # Create a second license for item2
    lic2 = License(
        publisher_name=seeded_license.publisher_name,
        software_description=seeded_license.software_description,
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
    )
    db_session.add(lic2)
    await db_session.flush()

    # Create two renewal sourcing items to merge
    item1 = SourcingItem(
        publisher_name=seeded_license.publisher_name,
        software_description=seeded_license.software_description,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=seeded_license.id,
    )
    item2 = SourcingItem(
        publisher_name=seeded_license.publisher_name,
        software_description=seeded_license.software_description,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=lic2.id,
    )
    db_session.add(item1)
    db_session.add(item2)
    await db_session.commit()

    resp = await test_app.post(
        "/api/sourcing/merge",
        headers=auth_headers,
        json={"sourcing_item_ids": [item1.id, item2.id]},
    )
    assert resp.status_code == 201
    rows = await get_audit_rows(db_session, "sourcing.merged")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 7 — po.updated
# ---------------------------------------------------------------------------

async def test_audit_po_updated(
    test_app, db_session, auth_headers, seeded_pending_order
):
    resp = await test_app.put(
        f"/api/pending-orders/{seeded_pending_order.id}",
        headers=auth_headers,
        json={"po_number": "PO-UPDATED-001", "supplier": "Test Supplier"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "po.updated")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 8 — po.deleted
# ---------------------------------------------------------------------------

async def test_audit_po_deleted(
    test_app, db_session, auth_headers, seeded_pending_order
):
    resp = await test_app.delete(
        f"/api/pending-orders/{seeded_pending_order.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204
    rows = await get_audit_rows(db_session, "po.deleted")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 9 — custom_field.created
# ---------------------------------------------------------------------------

async def test_audit_custom_field_created(
    test_app, db_session, auth_headers
):
    resp = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Test Field", "field_type": "text", "display_order": 0},
    )
    assert resp.status_code == 201
    rows = await get_audit_rows(db_session, "custom_field.created")
    assert len(rows) == 1
    assert rows[0].target_label == "Test Field"


# ---------------------------------------------------------------------------
# 10 — custom_field.updated
# ---------------------------------------------------------------------------

async def test_audit_custom_field_updated(
    test_app, db_session, auth_headers
):
    # Create a field first
    create_resp = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Field To Update", "field_type": "text", "display_order": 0},
    )
    assert create_resp.status_code == 201
    field_id = create_resp.json()["id"]

    resp = await test_app.patch(
        f"/api/custom-fields/{field_id}",
        headers=auth_headers,
        json={"name": "Renamed Field"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "custom_field.updated")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 11 — custom_field.deleted
# ---------------------------------------------------------------------------

async def test_audit_custom_field_deleted(
    test_app, db_session, auth_headers
):
    create_resp = await test_app.post(
        "/api/custom-fields/",
        headers=auth_headers,
        json={"name": "Field To Delete", "field_type": "text", "display_order": 0},
    )
    assert create_resp.status_code == 201
    field_id = create_resp.json()["id"]

    resp = await test_app.delete(
        f"/api/custom-fields/{field_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "custom_field.deleted")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# 12 — license.field_updated
# ---------------------------------------------------------------------------

async def test_audit_license_field_updated(
    test_app, db_session, auth_headers, seeded_license
):
    resp = await test_app.patch(
        f"/api/licenses/{seeded_license.id}/field",
        headers=auth_headers,
        json={"field": "supplier", "value": "New Supplier"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "license.field_updated")
    assert len(rows) == 1
    assert rows[0].target_id == str(seeded_license.id)


# ---------------------------------------------------------------------------
# 13 — auth.logout
# ---------------------------------------------------------------------------

async def test_audit_auth_logout(test_app, db_session, auth_headers):
    # auth_headers fixture already logged in, setting the session cookie on test_app.
    resp = await test_app.post("/api/auth/logout")
    assert resp.status_code == 204
    rows = await get_audit_rows(db_session, "auth.logout")
    assert len(rows) == 1
    assert rows[0].actor_email == "testadmin@test.local"


# ---------------------------------------------------------------------------
# 14 — auth.password_changed
# ---------------------------------------------------------------------------

async def test_audit_auth_password_changed(test_app, db_session, auth_headers):
    resp = await test_app.post(
        "/api/auth/change-password",
        headers=auth_headers,
        json={"current_password": "testpassword123", "new_password": "newtestpassword123"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "auth.password_changed")
    assert len(rows) == 1
    assert rows[0].actor_email == "testadmin@test.local"


# ---------------------------------------------------------------------------
# 15 — user.departments_updated
# ---------------------------------------------------------------------------

async def test_audit_user_departments_updated(test_app, db_session, auth_headers):
    hashed = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode()
    user = User(
        username="deptuser",
        email="deptuser@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}/departments",
        headers=auth_headers,
        json={"departments": ["Finance", "IT"]},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "user.departments_updated")
    assert len(rows) == 1
    assert rows[0].target_id == str(user.id)


# ---------------------------------------------------------------------------
# 16 — user_settings.updated
# ---------------------------------------------------------------------------

async def test_audit_user_settings_updated(test_app, db_session, auth_headers):
    resp = await test_app.put(
        "/api/settings",
        headers=auth_headers,
        json={"theme": "dark"},
    )
    assert resp.status_code == 200
    rows = await get_audit_rows(db_session, "user_settings.updated")
    assert len(rows) == 1
    assert rows[0].actor_email == "testadmin@test.local"

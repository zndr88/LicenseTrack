import bcrypt
from sqlalchemy import select

from app.models.api_token import ApiToken
from app.models.contract import Contract, ContractDocument
from app.models.document import Document, DocumentCategory, ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder
from app.models.settings import UserSettings
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.user import AuthProvider, User, UserRole
from app.models.webhook import WebhookEndpoint


def _make_user(
    username: str,
    password: str,
    *,
    role: UserRole = UserRole.admin,
    auth_provider: AuthProvider = AuthProvider.local,
    is_break_glass_admin: bool = False,
) -> User:
    return User(
        username=username,
        email=f"{username}@test.local",
        hashed_password=bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode(),
        role=role,
        auth_provider=auth_provider,
        is_active=True,
        is_break_glass_admin=is_break_glass_admin,
        must_change_password=False,
    )


async def test_break_glass_admin_cannot_be_converted_to_oidc(db_session, test_app, auth_headers):
    user = _make_user("admin", "password123", is_break_glass_admin=True)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "admin",
            "email": "admin@example.com",
            "role": "admin",
            "is_active": True,
            "auth_provider": "oidc",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_last_local_admin_cannot_be_disabled(db_session, test_app):
    user = _make_user("soleadmin", "password123")
    db_session.add(user)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "soleadmin", "password": "password123"},
    )
    assert login_resp.status_code == 200
    auth_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "soleadmin",
            "email": "soleadmin@example.com",
            "role": "admin",
            "is_active": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_break_glass_admin_cannot_be_deleted(db_session, test_app, auth_headers):
    user = _make_user("breakglass", "password123", is_break_glass_admin=True)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.delete(f"/api/users/{user.id}", headers=auth_headers)
    assert resp.status_code == 400


async def test_last_local_admin_cannot_be_deleted(db_session, test_app):
    user = _make_user("soleadmin2", "password123")
    db_session.add(user)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "soleadmin2", "password": "password123"},
    )
    assert login_resp.status_code == 200
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    viewer = _make_user("viewer1", "password123", role=UserRole.viewer)
    db_session.add(viewer)
    await db_session.commit()

    resp = await test_app.delete(f"/api/users/{user.id}", headers=headers)
    assert resp.status_code == 400


async def test_delete_user_clears_related_creator_and_uploader_references(
    db_session, test_app, auth_headers
):
    user = _make_user("delete_related_user", "password123", role=UserRole.editor)
    db_session.add(user)
    await db_session.flush()

    license_obj = License(
        publisher_name="Acme",
        software_description="Created License",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        created_by=user.id,
    )
    pending_order = PendingOrder(po_number="PO-USER-DELETE", created_by=user.id)
    sourcing_request = SourcingRequest(supplier="Acme", created_by=user.id)
    contract = Contract(contract_number="C-USER-DELETE", publisher_name="Acme", created_by=user.id)
    api_token = ApiToken(
        name="User token",
        token_hash="delete-related-token-hash",
        token_prefix="delrel",
        scopes="licenses:read",
        created_by=user.id,
    )
    webhook = WebhookEndpoint(
        name="User webhook",
        url="https://example.test/hook",
        secret="encrypted-secret",
        events="*",
        created_by=user.id,
    )
    db_session.add_all([license_obj, pending_order, sourcing_request, contract, api_token, webhook])
    await db_session.flush()

    sourcing_item = SourcingItem(
        publisher_name="Acme",
        software_description="Created Sourcing",
        currency="EUR",
        created_by=user.id,
        sourcing_request_id=sourcing_request.id,
        pending_order_id=pending_order.id,
    )
    document = Document(
        license_id=license_obj.id,
        filename="documents/user-delete/license.pdf",
        original_filename="license.pdf",
        file_size=1,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
        uploaded_by=user.id,
    )
    procurement_document = ProcurementDocument(
        po_number="PO-USER-DELETE",
        pending_order_id=pending_order.id,
        filename="procurement/user-delete/po.pdf",
        original_filename="po.pdf",
        file_size=1,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.purchase_order,
        uploaded_by=user.id,
    )
    quote_document = SourcingQuoteDocument(
        sourcing_request_id=sourcing_request.id,
        filename="sourcing/user-delete/quote.pdf",
        original_filename="quote.pdf",
        file_size=1,
        mime_type="application/pdf",
        uploaded_by=user.id,
    )
    contract_document = ContractDocument(
        contract_id=contract.id,
        filename="contracts/user-delete/contract.pdf",
        original_filename="contract.pdf",
        file_size=1,
        created_by=user.id,
    )
    db_session.add_all([sourcing_item, document, procurement_document, quote_document, contract_document])
    await db_session.commit()
    ids = {
        "user": user.id,
        "license": license_obj.id,
        "pending_order": pending_order.id,
        "sourcing_request": sourcing_request.id,
        "sourcing_item": sourcing_item.id,
        "contract": contract.id,
        "contract_document": contract_document.id,
        "document": document.id,
        "procurement_document": procurement_document.id,
        "quote_document": quote_document.id,
        "api_token": api_token.id,
        "webhook": webhook.id,
    }

    resp = await test_app.delete(f"/api/users/{ids['user']}", headers=auth_headers)

    assert resp.status_code == 204, resp.text
    db_session.expire_all()
    assert await db_session.get(User, ids["user"]) is None
    assert (await db_session.get(License, ids["license"])).created_by is None
    assert (await db_session.get(PendingOrder, ids["pending_order"])).created_by is None
    assert (await db_session.get(SourcingRequest, ids["sourcing_request"])).created_by is None
    assert (await db_session.get(SourcingItem, ids["sourcing_item"])).created_by is None
    assert (await db_session.get(Contract, ids["contract"])).created_by is None
    assert (await db_session.get(ContractDocument, ids["contract_document"])).created_by is None
    assert (await db_session.get(Document, ids["document"])).uploaded_by is None
    assert (await db_session.get(ProcurementDocument, ids["procurement_document"])).uploaded_by is None
    assert (await db_session.get(SourcingQuoteDocument, ids["quote_document"])).uploaded_by is None
    assert await db_session.get(ApiToken, ids["api_token"]) is None
    assert await db_session.get(WebhookEndpoint, ids["webhook"]) is None


async def test_oidc_user_reset_password_rejected(db_session, test_app, auth_headers):
    user = _make_user("oidcuser", "password123", auth_provider=AuthProvider.oidc)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}/reset-password",
        json={"new_password": "newpassword123"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_create_user_persists_viewer_download_permission(test_app, auth_headers):
    resp = await test_app.post(
        "/api/users",
        json={
            "username": "viewer_read_only",
            "email": "viewer_read_only@example.com",
            "password": "password123456",
            "role": "viewer",
            "allow_downloads": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["role"] == "viewer"
    assert body["allow_downloads"] is False


async def test_created_user_inherits_admin_regional_settings(db_session, test_app, auth_headers):
    # Give the acting admin (testadmin) distinctive regional preferences.
    admin = await db_session.scalar(select(User).where(User.username == "testadmin"))
    db_session.add(
        UserSettings(
            user_id=admin.id,
            theme="dark",
            display_currency="GBP",
            number_format_locale="en-GB",
            ui_size="large",
            date_format="YYYY-MM-DD",
            time_format="12h",
            time_zone="Europe/London",
            saved_views=[{"name": "Admin only view"}],
        )
    )
    await db_session.commit()

    resp = await test_app.post(
        "/api/users",
        json={
            "username": "inheritor",
            "email": "inheritor@example.com",
            "password": "password123456",
            "role": "viewer",
            "auth_provider": "local",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    new_user_id = resp.json()["id"]

    new_settings = await db_session.scalar(
        select(UserSettings).where(UserSettings.user_id == new_user_id)
    )
    assert new_settings is not None
    assert new_settings.theme == "dark"
    assert new_settings.display_currency == "GBP"
    assert new_settings.number_format_locale == "en-GB"
    assert new_settings.ui_size == "large"
    assert new_settings.date_format == "YYYY-MM-DD"
    assert new_settings.time_format == "12h"
    assert new_settings.time_zone == "Europe/London"
    # Personal layout state is NOT inherited.
    assert new_settings.saved_views == []


async def test_update_user_persists_viewer_download_permission(db_session, test_app, auth_headers):
    user = _make_user("viewer_toggle", "password123456", role=UserRole.viewer)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}",
        json={
            "username": "viewer_toggle",
            "email": "viewer_toggle@example.com",
            "role": "viewer",
            "is_active": True,
            "allow_downloads": False,
            "auth_provider": "local",
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["allow_downloads"] is False


async def test_legacy_role_update_changes_role_and_audits(db_session, test_app, auth_headers):
    user = _make_user("legacy_role_user", "password123456", role=UserRole.viewer)
    db_session.add(user)
    await db_session.commit()

    resp = await test_app.put(
        f"/api/users/{user.id}/role",
        json={"role": "editor"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"


async def test_legacy_role_update_preserves_last_local_admin(db_session, test_app):
    admin = _make_user("legacy_sole_admin", "password123456", role=UserRole.admin)
    db_session.add(admin)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "legacy_sole_admin", "password": "password123456"},
    )
    assert login_resp.status_code == 200
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = await test_app.put(
        f"/api/users/{admin.id}/role",
        json={"role": "viewer"},
        headers=headers,
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "At least one active local admin must always remain available"

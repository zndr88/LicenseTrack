import bcrypt
import pytest
from sqlalchemy import select

import app.services.storage as _storage_module
from app.models.audit_log import AuditLog
from app.models.pending_order import PendingOrder
from app.models.plugin import PluginAction
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess
from app.schemas.plugin import PluginActionCreate, PluginPermissionCreate, PluginRegistryCreate
from app.services.plugin_runtime_service import PluginRuntimeError
from app.services.plugin_registry_service import create_plugin_registry_record


@pytest.fixture(autouse=True)
def enable_developer_plugin_host(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_ENABLED", True)
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)


@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "documents").mkdir()
    return tmp_path


def _license_payload() -> dict:
    return {
        "publisherName": "Plugin Action Corp",
        "softwareDescription": "Action Suite",
        "licenseType": "subscription",
        "licenseMetric": "per_user",
        "quantity": "5",
        "currency": "EUR",
        "costCentre": "Finance",
    }


def _plugin_payload(
    *,
    key: str = "plugin-ai",
    granted_permissions: list[str] | None = None,
    required_role: str = "editor",
) -> PluginRegistryCreate:
    granted_permissions = granted_permissions or ["actions:invoke", "documents:read"]
    return PluginRegistryCreate(
        key=key,
        name="Plugin AI",
        publisher_name="Tests",
        publisher_url=None,
        description="Test plugin action provider.",
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path=f"/tmp/{key}",
        package_path=f"/tmp/{key}/package.zip",
        checksum_sha256="c" * 64,
        manifest={
            "manifestVersion": 1,
            "key": key,
            "name": "Plugin AI",
            "version": "0.1.0",
            "publisher": {"name": "Tests"},
            "licenseTrack": {"minVersion": "1.0.0"},
            "runtime": {
                "type": "managedProcess",
                "entrypoint": "runtime/plugin.py",
                "healthPath": "/health",
                "actionsBasePath": "/actions",
            },
            "permissions": granted_permissions,
            "actions": [
                {
                    "key": "parseDocument",
                    "label": "Parse Document",
                    "slot": "document.row.actions",
                    "handler": "parse_document",
                    "requiredRole": required_role,
                }
            ],
        },
        permissions=[
            PluginPermissionCreate(permission=permission, granted=True)
            for permission in granted_permissions
        ],
        settings=[],
        actions=[
            PluginActionCreate(
                key="parseDocument",
                label="Parse Document",
                slot="document.row.actions",
                handler="parse_document",
                required_role=required_role,
                enabled=True,
                description="Parse this document with the installed plugin.",
            )
        ],
    )


async def _install_enabled_plugin(db_session, **kwargs):
    plugin = await create_plugin_registry_record(db_session, _plugin_payload(**kwargs))
    plugin.status = "enabled"
    plugin.enabled = True
    plugin.runtime_status.health = "healthy"
    plugin.runtime_status.port = 49152
    plugin.runtime_status.process_metadata = {"token": "test-runtime-token"}
    for action in plugin.actions:
        action.enabled = True
    await db_session.commit()
    return plugin


def _slot_plugin_payload(
    *,
    key: str,
    slot: str,
    action_key: str,
    handler: str,
    granted_permissions: list[str],
    required_role: str = "editor",
) -> PluginRegistryCreate:
    return PluginRegistryCreate(
        key=key,
        name="Slot Plugin",
        publisher_name="Tests",
        publisher_url=None,
        description="Test plugin slot provider.",
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path=f"/tmp/{key}",
        package_path=f"/tmp/{key}/package.zip",
        checksum_sha256="d" * 64,
        manifest={
            "manifestVersion": 1,
            "key": key,
            "name": "Slot Plugin",
            "version": "0.1.0",
            "publisher": {"name": "Tests"},
            "licenseTrack": {"minVersion": "1.0.0"},
            "runtime": {
                "type": "managedProcess",
                "entrypoint": "runtime/plugin.py",
                "healthPath": "/health",
                "actionsBasePath": "/actions",
            },
            "permissions": granted_permissions,
            "actions": [
                {
                    "key": action_key,
                    "label": "Run Slot Action",
                    "slot": slot,
                    "handler": handler,
                    "requiredRole": required_role,
                }
            ],
        },
        permissions=[
            PluginPermissionCreate(permission=permission, granted=True)
            for permission in granted_permissions
        ],
        settings=[],
        actions=[
            PluginActionCreate(
                key=action_key,
                label="Run Slot Action",
                slot=slot,
                handler=handler,
                required_role=required_role,
                enabled=True,
                description="Run a slot action.",
            )
        ],
    )


async def _install_enabled_slot_plugin(db_session, **kwargs):
    plugin = await create_plugin_registry_record(db_session, _slot_plugin_payload(**kwargs))
    plugin.status = "enabled"
    plugin.enabled = True
    plugin.runtime_status.health = "healthy"
    plugin.runtime_status.port = 49153
    plugin.runtime_status.process_metadata = {"token": "test-runtime-token"}
    for action in plugin.actions:
        action.enabled = True
    await db_session.commit()
    return plugin


async def _create_license_document(test_app, auth_headers) -> tuple[int, int]:
    license_resp = await test_app.post("/api/licenses", headers=auth_headers, json=_license_payload())
    assert license_resp.status_code == 201, license_resp.text
    license_id = license_resp.json()["id"]
    upload_resp = await test_app.post(
        f"/api/licenses/{license_id}/documents",
        headers=auth_headers,
        files={"file": ("entitlement.pdf", b"%PDF-1.4 entitlement", "application/pdf")},
        data={"category": "entitlement"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    return license_id, upload_resp.json()["id"]


async def _viewer_headers(db_session, test_app) -> tuple[dict, int]:
    password = "viewerpassword123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    user = User(
        username="viewer-plugin-actions",
        email="viewer-plugin-actions@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(UserDepartmentAccess(user_id=user.id, department="Finance"))
    await db_session.commit()

    response = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer-plugin-actions", "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, user.id


async def test_plugin_action_list_filters_viewer_for_editor_action(test_app, db_session, auth_headers):
    await _install_enabled_plugin(db_session)
    _license_id, document_id = await _create_license_document(test_app, auth_headers)
    viewer_headers, _viewer_id = await _viewer_headers(db_session, test_app)

    response = await test_app.get(
        "/api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId="
        f"{document_id}",
        headers=viewer_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["actions"] == []


async def test_disabled_plugin_actions_are_hidden(test_app, db_session, auth_headers):
    plugin = await _install_enabled_plugin(db_session)
    plugin.enabled = False
    plugin.status = "disabled"
    await db_session.commit()
    _license_id, document_id = await _create_license_document(test_app, auth_headers)

    response = await test_app.get(
        f"/api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId={document_id}",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["actions"] == []


async def test_missing_permission_hides_and_rejects_plugin_action(test_app, db_session, auth_headers):
    await _install_enabled_plugin(db_session, key="under-permissioned", granted_permissions=["actions:invoke"])
    _license_id, document_id = await _create_license_document(test_app, auth_headers)

    list_response = await test_app.get(
        f"/api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId={document_id}",
        headers=auth_headers,
    )
    invoke_response = await test_app.post(
        "/api/plugin-actions/under-permissioned/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert list_response.status_code == 200, list_response.text
    assert list_response.json()["actions"] == []
    assert invoke_response.status_code == 409
    assert "missing required permission" in invoke_response.json()["detail"].lower()


async def test_plugin_action_invoke_sends_context_and_audits(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_plugin(db_session)
    license_id, document_id = await _create_license_document(test_app, auth_headers)
    captured = {}

    async def fake_invoke(_db, plugin_key, handler, payload, *, timeout_seconds=None):
        captured["plugin_key"] = plugin_key
        captured["handler"] = handler
        captured["payload"] = payload
        captured["timeout_seconds"] = timeout_seconds
        return {"status": "ok", "summary": "Parsed by plugin", "raw": {"ok": True}}

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    list_response = await test_app.get(
        f"/api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId={document_id}",
        headers=auth_headers,
    )
    invoke_response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert list_response.status_code == 200, list_response.text
    assert list_response.json()["actions"][0]["key"] == "plugin-ai:parseDocument"
    assert invoke_response.status_code == 200, invoke_response.text
    assert invoke_response.json()["summary"] == "Parsed by plugin"
    assert captured["plugin_key"] == "plugin-ai"
    assert captured["handler"] == "parse_document"
    assert captured["payload"]["actionKey"] == "parseDocument"
    assert captured["payload"]["handler"] == "parse_document"
    context = captured["payload"]["context"]
    expected_context = {
        "targetType": "license_document",
        "targetId": str(document_id),
        "documentId": document_id,
        "licenseId": license_id,
        "documentCategory": "entitlement",
        "fileName": "entitlement.pdf",
        "contentType": "application/pdf",
        "userRole": "admin",
    }
    assert {key: context[key] for key in expected_context} == expected_context
    assert context["runtimeAccess"]["settingsUrl"].endswith("/api/plugin-runtime/plugin-ai/settings")
    assert context["runtimeAccess"]["documentRefs"] == [
        {
            "type": "license_document",
            "id": document_id,
            "contentUrl": (
                "http://127.0.0.1:8000/api/plugin-runtime/plugin-ai/action-requests/"
                f"{captured['payload']['requestId']}/documents/license_document/{document_id}"
            ),
        }
    ]

    audit = await db_session.scalar(select(AuditLog).where(AuditLog.action == "plugin.action.invoked"))
    assert audit is not None
    assert audit.target_type == "license_document"
    assert audit.target_id == str(document_id)
    assert "pluginKey=plugin-ai" in audit.detail
    assert "actionKey=parseDocument" in audit.detail


async def test_runtime_error_is_returned_to_invoker(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_plugin(db_session)
    _license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_error(*_args, **_kwargs):
        raise PluginRuntimeError("boom")

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_error)

    response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert response.status_code == 409


async def test_plugin_action_invocation_requires_enabled_action(test_app, db_session, auth_headers):
    await _install_enabled_plugin(db_session)
    action = await db_session.scalar(select(PluginAction).where(PluginAction.action_key == "parseDocument"))
    action.enabled = False
    await db_session.commit()
    _license_id, document_id = await _create_license_document(test_app, auth_headers)

    response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert response.status_code == 409


async def test_plugin_action_suggestions_reject_unknown_target(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_plugin(
        db_session,
        granted_permissions=["actions:invoke", "documents:read", "suggestions:license:write"],
    )
    _license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "unknown_target",
                    "targetId": "1",
                    "fields": [{"field": "publisherName", "value": "New"}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert response.status_code == 409
    assert "unsupported official extension suggestion target" in response.json()["detail"].lower()


async def test_plugin_action_suggestions_require_target_permission(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_plugin(db_session)
    license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "license",
                    "targetId": str(license_id),
                    "fields": [{"field": "publisherName", "value": "New"}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert response.status_code == 409
    assert "missing required suggestion permission" in response.json()["detail"].lower()


@pytest.mark.parametrize("field_name", ["notARealLicenseField", "lifecycle_status"])
async def test_plugin_action_suggestions_reject_unknown_or_internal_fields(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
    field_name,
):
    await _install_enabled_plugin(
        db_session,
        granted_permissions=["actions:invoke", "documents:read", "suggestions:license:write"],
    )
    license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "license",
                    "targetId": str(license_id),
                    "fields": [{"field": field_name, "value": "blocked"}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )

    assert response.status_code == 409
    assert "unsupported suggested field" in response.json()["detail"].lower()


async def test_plugin_suggestion_accept_selected_fields_applies_only_selection_and_audits(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
):
    await _install_enabled_plugin(
        db_session,
        granted_permissions=["actions:invoke", "documents:read", "suggestions:license:write"],
    )
    license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "summary": "Parsed by plugin",
            "suggestions": [
                {
                    "targetType": "license",
                    "targetId": str(license_id),
                    "summary": "Plugin field suggestions",
                    "confidence": 0.93,
                    "fields": [
                        {"field": "publisherName", "value": "Suggested Publisher", "confidence": 0.93},
                        {"field": "quantity", "value": "17", "source": "Page 1"},
                    ],
                    "lineItems": [
                        {
                            "summary": "Proposed entitlement line",
                            "fields": [{"field": "quantity", "value": "17"}],
                        }
                    ],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    invoke_response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )
    assert invoke_response.status_code == 200, invoke_response.text
    assert invoke_response.json()["suggestionsCreated"] == 1

    list_response = await test_app.get(
        f"/api/plugin-suggestions?licenseId={license_id}",
        headers=auth_headers,
    )
    assert list_response.status_code == 200, list_response.text
    suggestion = list_response.json()[0]
    assert suggestion["status"] == "pending"
    assert suggestion["pluginKey"] == "plugin-ai"
    assert suggestion["lineItems"][0]["summary"] == "Proposed entitlement line"

    accept_response = await test_app.post(
        f"/api/plugin-suggestions/{suggestion['id']}/accept",
        headers=auth_headers,
        json={"suggestedFieldIndexes": [1]},
    )
    assert accept_response.status_code == 200, accept_response.text
    assert accept_response.json()["appliedFields"] == ["quantity"]

    license_response = await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)
    assert license_response.status_code == 200, license_response.text
    license_body = license_response.json()
    assert license_body["publisherName"] == "Plugin Action Corp"
    assert license_body["quantity"] == "17"

    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "plugin_suggestion.accepted")
    )
    assert audit is not None
    assert "pluginKey=plugin-ai" in audit.detail
    assert "actionKey=parseDocument" in audit.detail
    assert "targetType=license" in audit.detail
    assert f"targetId={license_id}" in audit.detail
    assert "reviewer=testadmin@test.local" in audit.detail
    assert "appliedFields=quantity" in audit.detail


async def test_plugin_suggestion_reject_does_not_mutate_license(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_plugin(
        db_session,
        granted_permissions=["actions:invoke", "documents:read", "suggestions:license:write"],
    )
    license_id, document_id = await _create_license_document(test_app, auth_headers)

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "license",
                    "targetId": str(license_id),
                    "fields": [{"field": "quantity", "value": "99"}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)
    invoke_response = await test_app.post(
        "/api/plugin-actions/plugin-ai/parseDocument/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": str(document_id)},
    )
    assert invoke_response.status_code == 200, invoke_response.text
    suggestion = (await test_app.get(f"/api/plugin-suggestions?licenseId={license_id}", headers=auth_headers)).json()[0]

    reject_response = await test_app.post(
        f"/api/plugin-suggestions/{suggestion['id']}/reject",
        headers=auth_headers,
    )
    assert reject_response.status_code == 200, reject_response.text
    assert reject_response.json()["suggestion"]["status"] == "rejected"

    license_response = await test_app.get(f"/api/licenses/{license_id}", headers=auth_headers)
    assert license_response.json()["quantity"] == "5"


async def test_new_plugin_suggestion_supersedes_previous_pending_for_same_plugin_action_target(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
):
    await _install_enabled_plugin(
        db_session,
        granted_permissions=["actions:invoke", "documents:read", "suggestions:license:write"],
    )
    license_id, document_id = await _create_license_document(test_app, auth_headers)
    call_count = {"value": 0}

    async def fake_invoke(*_args, **_kwargs):
        call_count["value"] += 1
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "license",
                    "targetId": str(license_id),
                    "summary": f"Suggestion {call_count['value']}",
                    "fields": [{"field": "quantity", "value": str(10 + call_count["value"])}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)
    for _ in range(2):
        response = await test_app.post(
            "/api/plugin-actions/plugin-ai/parseDocument/invoke",
            headers=auth_headers,
            json={"targetType": "license_document", "targetId": str(document_id)},
        )
        assert response.status_code == 200, response.text

    list_response = await test_app.get(f"/api/plugin-suggestions?licenseId={license_id}", headers=auth_headers)
    assert list_response.status_code == 200, list_response.text
    statuses_by_summary = {row["summary"]: row["status"] for row in list_response.json()}
    assert statuses_by_summary == {
        "Suggestion 1": "superseded",
        "Suggestion 2": "pending",
    }


async def test_sourcing_item_slot_sends_scoped_context(test_app, db_session, auth_headers, monkeypatch):
    await _install_enabled_slot_plugin(
        db_session,
        key="quote-parser",
        slot="sourcing.item.edit.actions",
        action_key="parseQuote",
        handler="parse_quote",
        granted_permissions=["actions:invoke", "procurement:read", "documents:read"],
    )
    request = SourcingRequest(supplier="Scoped Supplier")
    db_session.add(request)
    await db_session.flush()
    item = SourcingItem(
        sourcing_request_id=request.id,
        publisher_name="Scoped Publisher",
        software_description="Scoped Suite",
        quantity="3",
        currency="EUR",
    )
    unrelated_request = SourcingRequest(supplier="Other Supplier")
    db_session.add_all([item, unrelated_request])
    await db_session.flush()
    quote_doc = SourcingQuoteDocument(
        sourcing_request_id=request.id,
        filename="quote.pdf",
        original_filename="quote.pdf",
        file_size=12,
        mime_type="application/pdf",
    )
    unrelated_doc = SourcingQuoteDocument(
        sourcing_request_id=unrelated_request.id,
        filename="other.pdf",
        original_filename="other.pdf",
        file_size=12,
        mime_type="application/pdf",
    )
    db_session.add_all([quote_doc, unrelated_doc])
    await db_session.commit()
    captured = {}

    async def fake_invoke(_db, _plugin_key, _handler, payload, *, timeout_seconds=None):
        captured["payload"] = payload
        return {"status": "ok", "summary": "Scoped"}

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    list_response = await test_app.get(
        f"/api/plugin-actions?slot=sourcing.item.edit.actions&targetType=sourcing_item&targetId={item.id}",
        headers=auth_headers,
    )
    wrong_target_response = await test_app.get(
        f"/api/plugin-actions?slot=sourcing.item.edit.actions&targetType=pending_order_item&targetId={item.id}",
        headers=auth_headers,
    )
    invoke_response = await test_app.post(
        "/api/plugin-actions/quote-parser/parseQuote/invoke",
        headers=auth_headers,
        json={"targetType": "sourcing_item", "targetId": str(item.id)},
    )

    assert list_response.status_code == 200, list_response.text
    assert list_response.json()["actions"][0]["key"] == "quote-parser:parseQuote"
    assert wrong_target_response.status_code == 200, wrong_target_response.text
    assert wrong_target_response.json()["actions"] == []
    assert invoke_response.status_code == 200, invoke_response.text
    context = captured["payload"]["context"]
    assert context["targetType"] == "sourcing_item"
    assert context["sourcingRequestId"] == request.id
    assert context["sourcingItemId"] == item.id
    assert context["itemFields"]["publisherName"] == "Scoped Publisher"
    assert context["quoteDocumentIds"] == [quote_doc.id]
    assert unrelated_doc.id not in context["quoteDocumentIds"]


async def test_api_token_procurement_plugin_actions_require_procurement_scopes(
    test_app,
    db_session,
    auth_headers,
):
    await _install_enabled_slot_plugin(
        db_session,
        key="token-quote-parser",
        slot="sourcing.item.edit.actions",
        action_key="parseQuote",
        handler="parse_quote",
        granted_permissions=["actions:invoke", "procurement:read", "suggestions:sourcing_item:write"],
    )
    request = SourcingRequest(supplier="Token Scoped Supplier")
    db_session.add(request)
    await db_session.flush()
    item = SourcingItem(
        sourcing_request_id=request.id,
        publisher_name="Token Scoped Publisher",
        software_description="Token Scoped Suite",
        quantity="1",
        currency="EUR",
    )
    db_session.add(item)
    await db_session.commit()

    read_token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Document reader only", "scopes": ["documents:read"]},
    )
    assert read_token_resp.status_code == 201, read_token_resp.text
    read_token_headers = {"Authorization": f"Bearer {read_token_resp.json()['token']}"}

    list_response = await test_app.get(
        f"/api/plugin-actions?slot=sourcing.item.edit.actions&targetType=sourcing_item&targetId={item.id}",
        headers=read_token_headers,
    )
    assert list_response.status_code == 403
    assert "procurement:read" in list_response.json()["detail"]

    write_token_resp = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "Document writer only", "scopes": ["documents:write"]},
    )
    assert write_token_resp.status_code == 201, write_token_resp.text
    write_token_headers = {"Authorization": f"Bearer {write_token_resp.json()['token']}"}

    invoke_response = await test_app.post(
        "/api/plugin-actions/token-quote-parser/parseQuote/invoke",
        headers=write_token_headers,
        json={"targetType": "sourcing_item", "targetId": str(item.id)},
    )
    assert invoke_response.status_code == 403
    assert "procurement:write" in invoke_response.json()["detail"]


async def test_pending_order_conversion_rejects_unrelated_line_item_context(
    test_app,
    db_session,
    auth_headers,
):
    await _install_enabled_slot_plugin(
        db_session,
        key="po-parser",
        slot="pendingOrder.convert.actions",
        action_key="parsePo",
        handler="parse_po",
        granted_permissions=["actions:invoke", "procurement:read"],
    )
    order = PendingOrder(po_number="PO-Scoped")
    other_order = PendingOrder(po_number="PO-Other")
    db_session.add_all([order, other_order])
    await db_session.flush()
    item = SourcingItem(
        pending_order_id=order.id,
        publisher_name="Scoped Publisher",
        software_description="Scoped Suite",
        quantity="1",
        currency="EUR",
    )
    other_item = SourcingItem(
        pending_order_id=other_order.id,
        publisher_name="Other Publisher",
        software_description="Other Suite",
        quantity="1",
        currency="EUR",
    )
    db_session.add_all([item, other_item])
    await db_session.commit()

    response = await test_app.post(
        "/api/plugin-actions/po-parser/parsePo/invoke",
        headers=auth_headers,
        json={
            "targetType": "pending_order_conversion",
            "targetId": str(order.id),
            "context": {"selectedLineItemIds": [item.id, other_item.id]},
        },
    )

    assert response.status_code == 409
    assert "not part of this pending order" in response.json()["detail"].lower()


async def test_license_draft_slot_creates_pending_draft_suggestion_without_saving_license(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
):
    await _install_enabled_slot_plugin(
        db_session,
        key="draft-parser",
        slot="license.add.review.actions",
        action_key="parseDraft",
        handler="parse_draft",
        granted_permissions=["actions:invoke", "suggestions:license_draft:write"],
    )

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "license_draft",
                    "targetId": "manual",
                    "summary": "Draft values",
                    "fields": [{"field": "publisherName", "value": "Draft Publisher"}],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        "/api/plugin-actions/draft-parser/parseDraft/invoke",
        headers=auth_headers,
        json={
            "targetType": "license_draft",
            "targetId": "manual",
            "context": {"draftFields": {"publisherName": ""}},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["suggestionsCreated"] == 1
    suggestions = (await test_app.get("/api/plugin-suggestions?status=pending", headers=auth_headers)).json()
    draft_suggestion = next(row for row in suggestions if row["pluginKey"] == "draft-parser")
    assert draft_suggestion["targetType"] == "license_draft"
    assert draft_suggestion["licenseId"] is None
    assert draft_suggestion["suggestedFields"][0]["field"] == "publisherName"


async def test_draft_raw_file_content_requires_document_read_permission(
    test_app,
    db_session,
    auth_headers,
):
    await _install_enabled_slot_plugin(
        db_session,
        key="under-permissioned-draft-parser",
        slot="license.add.review.actions",
        action_key="parseDraft",
        handler="parse_draft",
        granted_permissions=["actions:invoke", "suggestions:license_draft:write"],
    )

    response = await test_app.post(
        "/api/plugin-actions/under-permissioned-draft-parser/parseDraft/invoke",
        headers=auth_headers,
        json={
            "targetType": "license_draft",
            "targetId": "manual",
            "context": {
                "fileContentBase64": "c2Vuc2l0aXZlIGRvY3VtZW50",
                "fileName": "invoice.pdf",
                "contentType": "application/pdf",
            },
        },
    )

    assert response.status_code == 409
    assert "missing required permission" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    ("slot", "target_type", "permission"),
    [
        ("sourcing.quote.add.actions", "sourcing_quote_draft", "suggestions:sourcing_quote_draft:write"),
        ("pendingOrder.add.actions", "pending_order_draft", "suggestions:pending_order_draft:write"),
    ],
)
async def test_draft_procurement_suggestions_are_listed_without_response_validation_errors(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
    slot,
    target_type,
    permission,
):
    plugin_key = f"{target_type.replace('_', '-')}-parser"
    await _install_enabled_slot_plugin(
        db_session,
        key=plugin_key,
        slot=slot,
        action_key="parseDraft",
        handler="parse_draft",
        granted_permissions=["actions:invoke", permission],
    )

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": target_type,
                    "targetId": "new",
                    "summary": "Draft procurement values",
                    "fields": [
                        {"field": "publisherName", "value": "Draft Publisher"},
                        {"field": "softwareDescription", "value": "Draft Suite"},
                    ],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        f"/api/plugin-actions/{plugin_key}/parseDraft/invoke",
        headers=auth_headers,
        json={"targetType": target_type, "targetId": "new", "context": {}},
    )

    assert response.status_code == 200, response.text
    assert response.json()["suggestionsCreated"] == 1

    list_response = await test_app.get("/api/plugin-suggestions?status=pending", headers=auth_headers)
    assert list_response.status_code == 200, list_response.text
    suggestion = next(row for row in list_response.json() if row["pluginKey"] == plugin_key)
    assert suggestion["targetType"] == target_type
    assert suggestion["licenseId"] is None
    assert suggestion["suggestedFields"][0]["field"] == "publisherName"


async def test_sourcing_slot_suggestion_can_store_multi_line_item_proposals(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
):
    await _install_enabled_slot_plugin(
        db_session,
        key="line-parser",
        slot="sourcing.item.edit.actions",
        action_key="parseLines",
        handler="parse_lines",
        granted_permissions=["actions:invoke", "procurement:read", "suggestions:sourcing_item:write"],
    )
    request = SourcingRequest(supplier="Line Supplier")
    db_session.add(request)
    await db_session.flush()
    item = SourcingItem(
        sourcing_request_id=request.id,
        publisher_name="Line Publisher",
        software_description="Line Suite",
        quantity="1",
        currency="EUR",
    )
    db_session.add(item)
    await db_session.commit()

    async def fake_invoke(*_args, **_kwargs):
        return {
            "status": "ok",
            "suggestions": [
                {
                    "targetType": "sourcing_item",
                    "targetId": str(item.id),
                    "summary": "Additional quote lines",
                    "fields": [],
                    "lineItems": [
                        {
                            "summary": "Second line",
                            "fields": [
                                {"field": "publisherName", "value": "Line Publisher"},
                                {"field": "softwareDescription", "value": "Second Suite"},
                                {"field": "quantity", "value": "5"},
                            ],
                        }
                    ],
                }
            ],
        }

    monkeypatch.setattr("app.services.plugin_action_service.invoke_plugin_runtime_action", fake_invoke)

    response = await test_app.post(
        "/api/plugin-actions/line-parser/parseLines/invoke",
        headers=auth_headers,
        json={"targetType": "sourcing_item", "targetId": str(item.id)},
    )

    assert response.status_code == 200, response.text
    suggestions = (await test_app.get("/api/plugin-suggestions?status=pending", headers=auth_headers)).json()
    suggestion = next(row for row in suggestions if row["pluginKey"] == "line-parser")
    assert suggestion["targetType"] == "sourcing_item"
    assert suggestion["lineItems"][0]["summary"] == "Second line"
    assert suggestion["lineItems"][0]["fields"][1]["value"] == "Second Suite"

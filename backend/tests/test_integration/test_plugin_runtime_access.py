import base64

import pytest

import app.services.storage as _storage_module
from app.models.document import Document, DocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.schemas.plugin import (
    PluginActionCreate,
    PluginPermissionCreate,
    PluginRegistryCreate,
    PluginSettingDefinitionCreate,
    PluginSettingsUpdateRequest,
)
from app.services import storage
from app.services.plugin_registry_service import create_plugin_registry_record
from app.services.plugin_runtime_service import register_runtime_action_scope, unregister_runtime_action_scope
from app.services.plugin_settings_service import update_plugin_settings


@pytest.fixture(autouse=True)
def enable_developer_plugin_host(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_ENABLED", True)
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)


@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "documents").mkdir()
    return tmp_path


def _plugin_payload() -> PluginRegistryCreate:
    return PluginRegistryCreate(
        key="runtime-access",
        name="Runtime Access",
        publisher_name="Tests",
        publisher_url=None,
        description=None,
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path="/tmp/runtime-access",
        package_path="/tmp/runtime-access/package.zip",
        checksum_sha256="e" * 64,
        manifest={
            "manifestVersion": 1,
            "key": "runtime-access",
            "name": "Runtime Access",
            "version": "0.1.0",
            "publisher": {"name": "Tests"},
            "licenseTrack": {"minVersion": "1.0.0"},
            "runtime": {
                "type": "managedProcess",
                "entrypoint": "runtime/plugin.py",
                "healthPath": "/health",
                "actionsBasePath": "/actions",
            },
            "permissions": ["actions:invoke", "documents:read", "plugin:settings:read"],
            "settings": [
                {
                    "key": "apiKey",
                    "label": "API Key",
                    "type": "secret",
                    "required": True,
                },
                {
                    "key": "testMode",
                    "label": "Test mode",
                    "type": "boolean",
                    "required": False,
                },
            ],
            "actions": [
                {
                    "key": "parseDocument",
                    "label": "Parse Document",
                    "slot": "document.row.actions",
                    "handler": "parse_document",
                    "requiredRole": "editor",
                }
            ],
        },
        permissions=[
            PluginPermissionCreate(permission="actions:invoke", granted=True),
            PluginPermissionCreate(permission="documents:read", granted=True),
            PluginPermissionCreate(permission="plugin:settings:read", granted=True),
        ],
        settings=[
            PluginSettingDefinitionCreate(key="apiKey", type="secret", label="API Key", required=True),
            PluginSettingDefinitionCreate(key="testMode", type="boolean", label="Test mode", required=False),
        ],
        actions=[
            PluginActionCreate(
                key="parseDocument",
                label="Parse Document",
                slot="document.row.actions",
                handler="parse_document",
                required_role="editor",
                enabled=True,
            )
        ],
    )


async def _install_runtime_access_plugin(db_session, *, token: str = "runtime-token"):
    plugin = await create_plugin_registry_record(db_session, _plugin_payload())
    plugin.enabled = True
    plugin.status = "enabled"
    plugin.runtime_status.health = "healthy"
    plugin.runtime_status.process_metadata = {"token": token}
    for action in plugin.actions:
        action.enabled = True
    await update_plugin_settings(
        db_session,
        plugin.key,
        PluginSettingsUpdateRequest(
            values=[
                {"key": "apiKey", "value": "sk-runtime-secret"},
                {"key": "testMode", "value": True},
            ]
        ),
        updated_by=None,
    )
    await db_session.commit()
    return plugin


async def _create_license_document(db_session, content: bytes = b"runtime document text") -> Document:
    license_obj = License(
        publisher_name="Runtime Publisher",
        software_description="Runtime Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        currency="EUR",
    )
    db_session.add(license_obj)
    await db_session.flush()
    stored_path, file_size = storage.save_file_bytes(content, "runtime.txt", license_obj.id)
    document = Document(
        license_id=license_obj.id,
        filename=stored_path,
        original_filename="runtime.txt",
        file_size=file_size,
        mime_type="text/plain",
        category=DocumentCategory.entitlement,
    )
    db_session.add(document)
    await db_session.commit()
    return document


async def test_runtime_settings_endpoint_returns_unmasked_own_settings(test_app, db_session):
    await _install_runtime_access_plugin(db_session)

    response = await test_app.get(
        "/api/plugin-runtime/runtime-access/settings",
        headers={"Authorization": "Bearer runtime-token"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pluginKey"] == "runtime-access"
    values = {item["key"]: item for item in body["values"]}
    assert values["apiKey"]["value"] == "sk-runtime-secret"
    assert values["apiKey"]["configured"] is True
    assert values["testMode"]["value"] is True
    assert body["missingRequired"] == []


async def test_runtime_settings_endpoint_rejects_wrong_token(test_app, db_session):
    await _install_runtime_access_plugin(db_session)

    response = await test_app.get(
        "/api/plugin-runtime/runtime-access/settings",
        headers={"Authorization": "Bearer wrong"},
    )

    assert response.status_code == 401


async def test_runtime_settings_endpoint_requires_declared_permission(test_app, db_session):
    plugin = await _install_runtime_access_plugin(db_session)
    for permission in plugin.permissions:
        if permission.permission == "plugin:settings:read":
            permission.granted = False
    await db_session.commit()

    response = await test_app.get(
        "/api/plugin-runtime/runtime-access/settings",
        headers={"Authorization": "Bearer runtime-token"},
    )

    assert response.status_code == 409
    assert "plugin:settings:read" in response.json()["detail"]


async def test_runtime_document_endpoint_returns_only_scoped_document_content(test_app, db_session):
    await _install_runtime_access_plugin(db_session)
    document = await _create_license_document(db_session)
    unrelated_document = await _create_license_document(db_session, b"do not leak")
    request_id = "request-123"
    register_runtime_action_scope("runtime-access", request_id, {"documentId": document.id})

    try:
        response = await test_app.get(
            f"/api/plugin-runtime/runtime-access/action-requests/{request_id}/documents/license_document/{document.id}",
            headers={"Authorization": "Bearer runtime-token"},
        )
        unrelated_response = await test_app.get(
            f"/api/plugin-runtime/runtime-access/action-requests/{request_id}/documents/license_document/{unrelated_document.id}",
            headers={"Authorization": "Bearer runtime-token"},
        )
    finally:
        unregister_runtime_action_scope("runtime-access", request_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["documentType"] == "license_document"
    assert body["documentId"] == document.id
    assert body["fileName"] == "runtime.txt"
    assert body["contentType"] == "text/plain"
    assert base64.b64decode(body["contentBase64"]) == b"runtime document text"
    assert body["text"] == "runtime document text"
    assert unrelated_response.status_code == 409


async def test_runtime_document_scope_is_cleared_after_unregister(test_app, db_session):
    await _install_runtime_access_plugin(db_session)
    document = await _create_license_document(db_session)
    request_id = "request-cleared"
    register_runtime_action_scope("runtime-access", request_id, {"documentId": document.id})
    unregister_runtime_action_scope("runtime-access", request_id)

    response = await test_app.get(
        f"/api/plugin-runtime/runtime-access/action-requests/{request_id}/documents/license_document/{document.id}",
        headers={"Authorization": "Bearer runtime-token"},
    )

    assert response.status_code == 409

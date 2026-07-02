import io
import json
import textwrap
import zipfile

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.document import Document, DocumentCategory
from app.models.extension import ExtensionCapability
from app.models.license import License, LicenseMetric, LicenseType
from app.models.audit_log import AuditLog
from app.models.plugin import Plugin, PluginAction, PluginPermission, PluginSettingValue
from app.models.plugin_suggestion import PluginSuggestion
from app.schemas.plugin import PLUGIN_SECRET_MASK
from app.services.crypto_service import decrypt_secret
from app.services.plugin_runtime_service import stop_plugin_runtime


@pytest.fixture(autouse=True)
def patch_plugin_storage(tmp_path, monkeypatch):
    plugin_storage = tmp_path / "plugins"
    monkeypatch.setattr(settings, "PLUGIN_STORAGE_PATH", str(plugin_storage))
    return plugin_storage


def _manifest(key: str = "test-plugin") -> dict:
    return {
        "manifestVersion": 1,
        "key": key,
        "name": "Test Plugin",
        "version": "0.1.0",
        "publisher": {"name": "Test Publisher"},
        "licenseTrack": {"minVersion": "1.0.0", "maxVersionExclusive": "2.0.0"},
        "description": "A test plugin.",
        "runtime": {
            "type": "managedProcess",
            "entrypoint": "runtime/test-plugin.py",
            "healthPath": "/health",
        },
        "permissions": ["documents:read", "actions:invoke"],
        "settings": [
            {
                "key": "apiKey",
                "label": "API Key",
                "type": "secret",
                "required": True,
            }
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
    }


def _plugin_zip(manifest: dict | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if manifest is not None:
            archive.writestr("plugin.ltplugin", json.dumps(manifest))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/test-plugin.py", "print('ok')")
    return buffer.getvalue()


def _runtime_worker_script() -> str:
    return textwrap.dedent(
        """
        import json
        import os
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        TOKEN = os.environ["LT_PLUGIN_TOKEN"]
        PORT = int(os.environ["LT_PLUGIN_PORT"])

        class Handler(BaseHTTPRequestHandler):
            def _authorized(self):
                return self.headers.get("Authorization") == f"Bearer {TOKEN}"

            def _write(self, status, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if not self._authorized():
                    self._write(401, {"status": "error"})
                    return
                if self.path == "/health":
                    print(f"runtime health ok secret=sk-runtime token={TOKEN}", flush=True)
                    self._write(200, {"status": "ok", "version": os.environ["LT_PLUGIN_VERSION"], "details": {}})
                    return
                self._write(404, {"status": "error"})

            def log_message(self, format, *args):
                return

        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        """
    ).strip()


def _runtime_plugin_zip() -> bytes:
    manifest = _manifest("runtime-plugin")
    manifest["runtime"]["startupTimeoutSeconds"] = 3
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.ltplugin", json.dumps(manifest))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/test-plugin.py", _runtime_worker_script())
    return buffer.getvalue()


def _lifecycle_plugin_zip(*, incompatible: bool = False) -> bytes:
    manifest = _manifest("lifecycle-plugin")
    manifest["runtime"]["startupTimeoutSeconds"] = 3
    manifest["capabilities"] = [
        {
            "key": "lifecycle-doc-processor",
            "type": "document.processing",
            "description": "Lifecycle fixture document processor.",
        }
    ]
    if incompatible:
        manifest["licenseTrack"] = {"minVersion": "99.0.0"}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.ltplugin", json.dumps(manifest))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/test-plugin.py", _runtime_worker_script())
    return buffer.getvalue()


def _license_track_ai_manifest() -> dict:
    return {
        "manifestVersion": 1,
        "key": "licensetrack-ai",
        "name": "LicenseTrack AI",
        "version": "0.1.0",
        "publisher": {"name": "LicenseTrack"},
        "licenseTrack": {"minVersion": "1.0.0", "maxVersionExclusive": "2.0.0"},
        "description": "AI-assisted document parsing for LicenseTrack.",
        "runtime": {
            "type": "managedProcess",
            "entrypoint": "runtime/run-plugin.py",
            "healthPath": "/health",
            "actionsBasePath": "/actions",
            "timeoutSeconds": 10,
            "startupTimeoutSeconds": 3,
        },
        "permissions": [
            "actions:invoke",
            "documents:read",
            "procurement:read",
            "suggestions:license:write",
            "suggestions:license_draft:write",
            "suggestions:sourcing_item:write",
            "suggestions:pending_order_item:write",
            "suggestions:pending_order_conversion:write",
            "plugin:settings:read",
        ],
        "settings": [
            {
                "key": "anthropicApiKey",
                "label": "Anthropic API Key",
                "type": "secret",
                "required": True,
                "order": 10,
            },
            {
                "key": "testMode",
                "label": "Test mode",
                "type": "boolean",
                "required": False,
                "default": True,
                "order": 20,
            },
        ],
        "actions": [
            {
                "key": "parseQuote",
                "label": "Parse Quote",
                "slot": "sourcing.item.edit.actions",
                "handler": "parse_quote",
                "requiredRole": "editor",
            },
            {
                "key": "parsePurchaseOrder",
                "label": "Parse Purchase Order",
                "slot": "pendingOrder.line.edit.actions",
                "handler": "parse_purchase_order",
                "requiredRole": "editor",
            },
            {
                "key": "parsePendingOrderConversion",
                "label": "Parse Pending Order",
                "slot": "pendingOrder.convert.actions",
                "handler": "parse_pending_order_conversion",
                "requiredRole": "editor",
            },
            {
                "key": "parseLicenseDocument",
                "label": "Parse License Document",
                "slot": "document.row.actions",
                "handler": "parse_license_document",
                "requiredRole": "editor",
            },
            {
                "key": "parseExistingDocument",
                "label": "Parse Draft Document",
                "slot": "license.add.review.actions",
                "handler": "parse_existing_document",
                "requiredRole": "editor",
            },
        ],
    }


def _license_track_ai_runtime_script() -> str:
    return textwrap.dedent(
        """
        import json
        import os
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        TOKEN = os.environ["LT_PLUGIN_TOKEN"]
        PORT = int(os.environ["LT_PLUGIN_PORT"])

        def _license_suggestion(context):
            license_id = context.get("licenseId")
            return {
                "targetType": "license",
                "targetId": str(license_id),
                "summary": "Fixture parser extracted license metadata.",
                "confidence": 0.95,
                "fields": [
                    {
                        "field": "publisherName",
                        "value": "AI Parsed Publisher",
                        "confidence": 0.96,
                        "source": context.get("fileName") or "fixture",
                    }
                ],
            }

        def _draft_suggestion(context):
            return {
                "targetType": "license_draft",
                "targetId": str(context.get("targetId") or "draft"),
                "summary": "Fixture parser extracted draft metadata.",
                "confidence": 0.9,
                "fields": [{"field": "publisherName", "value": "AI Draft Publisher"}],
            }

        def _procurement_suggestion(context):
            target_type = context.get("targetType")
            target_id = context.get("targetId")
            return {
                "targetType": target_type,
                "targetId": str(target_id),
                "summary": "Fixture parser extracted procurement metadata.",
                "confidence": 0.9,
                "fields": [{"field": "publisherName", "value": "AI Procurement Publisher"}],
            }

        class Handler(BaseHTTPRequestHandler):
            def _authorized(self):
                return self.headers.get("Authorization") == f"Bearer {TOKEN}"

            def _write(self, status, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if not self._authorized():
                    self._write(401, {"status": "error"})
                    return
                if self.path == "/health":
                    self._write(200, {"status": "ok", "version": os.environ["LT_PLUGIN_VERSION"], "details": {"mode": "fixture"}})
                    return
                self._write(404, {"status": "error"})

            def do_POST(self):
                if not self._authorized():
                    self._write(401, {"status": "error"})
                    return
                length = int(self.headers.get("Content-Length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                context = payload.get("context") or {}
                handler = self.path.rsplit("/", 1)[-1]
                if handler == "parse_license_document":
                    suggestion = _license_suggestion(context)
                elif handler == "parse_existing_document":
                    suggestion = _draft_suggestion(context)
                else:
                    suggestion = _procurement_suggestion(context)
                self._write(200, {"status": "ok", "summary": f"{handler} completed", "suggestions": [suggestion]})

            def log_message(self, format, *args):
                return

        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        """
    ).strip()


def _license_track_ai_plugin_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.ltplugin", json.dumps(_license_track_ai_manifest()))
        archive.writestr("README.md", "LicenseTrack AI fixture plugin for host integration tests.")
        archive.writestr("LICENSE", "Test fixture license")
        archive.writestr("runtime/run-plugin.py", _license_track_ai_runtime_script())
    return buffer.getvalue()


async def test_admin_can_preview_valid_plugin_install(test_app, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}

    response = await test_app.post("/api/plugins/preview-install", headers=auth_headers, files=files)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["installable"] is True
    assert body["manifest"]["key"] == "test-plugin"
    assert body["compatibilityStatus"] == "compatible"
    assert [item["permission"] for item in body["permissions"]] == ["documents:read", "actions:invoke"]


async def test_preview_invalid_package_returns_issues(test_app, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(None), "application/zip")}

    response = await test_app.post("/api/plugins/preview-install", headers=auth_headers, files=files)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["installable"] is False
    assert any(issue["code"] == "manifest_location_invalid" for issue in body["issues"])


async def test_admin_can_install_plugin_disabled(test_app, db_session, auth_headers, patch_plugin_storage):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}

    response = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["key"] == "test-plugin"
    assert body["status"] == "disabled"
    assert body["enabled"] is False
    assert body["runtimeStatus"]["health"] == "unknown"
    assert body["actions"][0]["enabled"] is False

    install_path = patch_plugin_storage / "test-plugin" / "0.1.0"
    assert (install_path / "plugin.ltplugin").exists()
    assert (install_path / "runtime" / "test-plugin.py").exists()
    assert (install_path / "package.zip").exists()

    stored = await db_session.scalar(select(Plugin).where(Plugin.key == "test-plugin"))
    assert stored is not None
    assert stored.enabled is False

    audit_action = await db_session.scalar(select(AuditLog.action).where(AuditLog.action == "plugin.installed"))
    assert audit_action == "plugin.installed"


async def test_install_invalid_package_is_rejected(test_app, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(None), "application/zip")}

    response = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)

    assert response.status_code == 422
    assert response.json()["detail"]["installable"] is False


async def test_duplicate_install_is_rejected(test_app, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}
    first = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert first.status_code == 201, first.text

    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}
    second = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)

    assert second.status_code == 409


async def test_plugin_list_and_detail_routes(test_app, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text

    list_response = await test_app.get("/api/plugins", headers=auth_headers)
    detail_response = await test_app.get("/api/plugins/test-plugin", headers=auth_headers)

    assert list_response.status_code == 200
    assert [plugin["key"] for plugin in list_response.json()] == ["test-plugin"]
    assert detail_response.status_code == 200
    assert detail_response.json()["key"] == "test-plugin"


async def test_admin_can_read_and_update_plugin_settings(test_app, db_session, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text

    read_response = await test_app.get("/api/plugins/test-plugin/settings", headers=auth_headers)
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["missingRequired"] == ["apiKey"]

    update_response = await test_app.put(
        "/api/plugins/test-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-secret"}]},
    )

    assert update_response.status_code == 200, update_response.text
    body = update_response.json()
    assert body["missingRequired"] == []
    assert body["values"][0]["value"] == PLUGIN_SECRET_MASK
    assert body["values"][0]["masked"] is True

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "test-plugin"))
    stored = await db_session.scalar(
        select(PluginSettingValue).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )
    assert decrypt_secret(stored.encrypted_value) == "sk-secret"

    audit = await db_session.scalar(select(AuditLog).where(AuditLog.action == "plugin.settings.updated"))
    assert audit is not None
    assert "apiKey" in audit.detail
    assert "sk-secret" not in audit.detail


async def test_masked_plugin_secret_save_preserves_value(test_app, db_session, auth_headers):
    files = {"file": ("test-plugin.zip", _plugin_zip(_manifest()), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text
    first = await test_app.put(
        "/api/plugins/test-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-original"}]},
    )
    assert first.status_code == 200

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "test-plugin"))
    before = await db_session.scalar(
        select(PluginSettingValue.encrypted_value).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )

    second = await test_app.put(
        "/api/plugins/test-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": PLUGIN_SECRET_MASK, "masked": True}]},
    )
    assert second.status_code == 200
    after = await db_session.scalar(
        select(PluginSettingValue.encrypted_value).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )
    assert before == after


async def test_admin_can_restart_runtime_and_read_redacted_logs(test_app, db_session, auth_headers):
    files = {"file": ("runtime-plugin.zip", _runtime_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text
    configure = await test_app.put(
        "/api/plugins/runtime-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-runtime"}]},
    )
    assert configure.status_code == 200, configure.text

    restart = await test_app.post("/api/plugins/runtime-plugin/runtime/restart", headers=auth_headers)
    assert restart.status_code == 200, restart.text
    body = restart.json()
    assert body["health"] == "healthy"
    assert body["pid"]
    assert body["port"]

    try:
        logs = await test_app.get("/api/plugins/runtime-plugin/runtime/logs", headers=auth_headers)
        assert logs.status_code == 200, logs.text
        assert "runtime health ok" in logs.json()["log"]
        assert "sk-runtime" not in logs.json()["log"]
        assert "token=[redacted]" in logs.json()["log"]
        assert "[redacted]" in logs.json()["log"]

        audit = await db_session.scalar(select(AuditLog).where(AuditLog.action == "plugin.runtime.restarted"))
        assert audit is not None
        assert "health=healthy" in audit.detail
    finally:
        await stop_plugin_runtime(db_session, "runtime-plugin")


async def test_enable_rejects_missing_required_settings(test_app, db_session, auth_headers):
    files = {"file": ("lifecycle-plugin.zip", _lifecycle_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text

    response = await test_app.post("/api/plugins/lifecycle-plugin/enable", headers=auth_headers)

    assert response.status_code == 409
    assert "Missing required plugin setting" in response.json()["detail"]

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "lifecycle-plugin"))
    assert plugin is not None
    assert plugin.enabled is False
    action_enabled = await db_session.scalar(
        select(PluginAction.enabled).where(PluginAction.plugin_id == plugin.id)
    )
    assert action_enabled is False


async def test_enable_rejects_incompatible_plugin(test_app, db_session, auth_headers):
    files = {"file": ("lifecycle-plugin.zip", _lifecycle_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text

    configure = await test_app.put(
        "/api/plugins/lifecycle-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-runtime"}]},
    )
    assert configure.status_code == 200, configure.text
    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "lifecycle-plugin"))
    plugin.compatibility_status = "incompatible"
    await db_session.commit()

    response = await test_app.post("/api/plugins/lifecycle-plugin/enable", headers=auth_headers)

    assert response.status_code == 409
    assert "not compatible" in response.json()["detail"]


async def test_admin_can_enable_and_disable_plugin_lifecycle(test_app, db_session, auth_headers):
    files = {"file": ("lifecycle-plugin.zip", _lifecycle_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text
    configure = await test_app.put(
        "/api/plugins/lifecycle-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-runtime"}]},
    )
    assert configure.status_code == 200, configure.text

    enable = await test_app.post("/api/plugins/lifecycle-plugin/enable", headers=auth_headers)
    assert enable.status_code == 200, enable.text
    enabled_body = enable.json()
    assert enabled_body["status"] == "enabled"
    assert enabled_body["enabled"] is True
    assert enabled_body["runtimeStatus"]["health"] == "healthy"
    assert all(permission["granted"] for permission in enabled_body["permissions"])
    assert all(action["enabled"] for action in enabled_body["actions"])

    capability = await db_session.scalar(
        select(ExtensionCapability).where(ExtensionCapability.key == "lifecycle-doc-processor")
    )
    assert capability is not None
    assert capability.status == "available"
    assert capability.details["pluginKey"] == "lifecycle-plugin"

    disable = await test_app.post("/api/plugins/lifecycle-plugin/disable", headers=auth_headers)
    assert disable.status_code == 200, disable.text
    disabled_body = disable.json()
    assert disabled_body["status"] == "disabled"
    assert disabled_body["enabled"] is False
    assert disabled_body["runtimeStatus"]["health"] == "stopped"
    assert all(not action["enabled"] for action in disabled_body["actions"])

    await db_session.refresh(capability)
    assert capability.status == "unavailable"

    # After disabling, the action discovery endpoint still responds 200 but the
    # disabled plugin's action must no longer be offered for the slot. The
    # endpoint intentionally returns an empty list (rather than erroring) so the
    # frontend row-action lookup degrades gracefully.
    actions = await test_app.get(
        "/api/plugin-actions",
        headers=auth_headers,
        params={"slot": "document.row.actions", "targetType": "license_document", "targetId": "1"},
    )
    assert actions.status_code == 200, actions.text
    assert actions.json()["actions"] == []


async def test_enable_runtime_startup_crash_returns_conflict(
    test_app,
    db_session,
    auth_headers,
    monkeypatch,
):
    async def fake_restart(_db, _plugin_key):
        raise RuntimeError("runtime exploded")

    monkeypatch.setattr("app.services.plugin_lifecycle_service.restart_plugin_runtime", fake_restart)

    files = {"file": ("lifecycle-plugin.zip", _lifecycle_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text
    configure = await test_app.put(
        "/api/plugins/lifecycle-plugin/settings",
        headers=auth_headers,
        json={"values": [{"key": "apiKey", "value": "sk-runtime"}]},
    )
    assert configure.status_code == 200, configure.text

    response = await test_app.post("/api/plugins/lifecycle-plugin/enable", headers=auth_headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "runtime exploded"

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "lifecycle-plugin"))
    assert plugin is not None
    assert plugin.status == "error"
    assert plugin.enabled is False
    assert plugin.last_error == "runtime exploded"


async def test_uninstall_removes_plugin_files_and_preserves_suggestion_history(
    test_app,
    db_session,
    auth_headers,
    patch_plugin_storage,
):
    files = {"file": ("lifecycle-plugin.zip", _lifecycle_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=files)
    assert install.status_code == 201, install.text

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "lifecycle-plugin"))
    assert plugin is not None
    suggestion = PluginSuggestion(
        plugin_id=plugin.id,
        plugin_key=plugin.key,
        action_key="parseDocument",
        target_type="license_draft",
        target_id="draft",
        status="pending",
        suggested_fields=[{"field": "publisherName", "value": "History"}],
        line_items=[],
        raw_output={},
    )
    db_session.add(suggestion)
    await db_session.commit()

    install_path = patch_plugin_storage / "lifecycle-plugin" / "0.1.0"
    assert install_path.exists()

    response = await test_app.delete("/api/plugins/lifecycle-plugin", headers=auth_headers)

    assert response.status_code == 204, response.text
    assert not install_path.exists()
    assert await db_session.scalar(select(Plugin).where(Plugin.key == "lifecycle-plugin")) is None

    stored_suggestion = await db_session.get(PluginSuggestion, suggestion.id)
    assert stored_suggestion is not None
    assert stored_suggestion.plugin_id is None
    assert stored_suggestion.plugin_key == "lifecycle-plugin"


async def test_licensetrack_ai_fixture_installs_invokes_and_applies_suggestion(
    test_app,
    db_session,
    auth_headers,
):
    preview_files = {"file": ("licensetrack-ai.zip", _license_track_ai_plugin_zip(), "application/zip")}
    preview = await test_app.post("/api/plugins/preview-install", headers=auth_headers, files=preview_files)
    assert preview.status_code == 200, preview.text
    preview_body = preview.json()
    assert preview_body["installable"] is True
    assert preview_body["manifest"]["key"] == "licensetrack-ai"
    assert {action["slot"] for action in preview_body["manifest"]["actions"]} == {
        "sourcing.item.edit.actions",
        "pendingOrder.line.edit.actions",
        "pendingOrder.convert.actions",
        "license.add.review.actions",
        "document.row.actions",
    }

    install_files = {"file": ("licensetrack-ai.zip", _license_track_ai_plugin_zip(), "application/zip")}
    install = await test_app.post("/api/plugins/install", headers=auth_headers, files=install_files)
    assert install.status_code == 201, install.text
    assert install.json()["status"] == "disabled"

    settings_response = await test_app.put(
        "/api/plugins/licensetrack-ai/settings",
        headers=auth_headers,
        json={
            "values": [
                {"key": "anthropicApiKey", "value": "sk-ant-test-placeholder"},
                {"key": "testMode", "value": True},
            ]
        },
    )
    assert settings_response.status_code == 200, settings_response.text
    assert settings_response.json()["missingRequired"] == []

    plugin = await db_session.scalar(select(Plugin).where(Plugin.key == "licensetrack-ai"))
    assert plugin is not None
    plugin.enabled = True
    plugin.status = "enabled"
    actions = await db_session.scalars(select(PluginAction).where(PluginAction.plugin_id == plugin.id))
    for action in actions.all():
        action.enabled = True
    permissions = await db_session.scalars(select(PluginPermission).where(PluginPermission.plugin_id == plugin.id))
    for permission in permissions.all():
        permission.granted = True

    license_obj = License(
        publisher_name="Original Publisher",
        software_description="Fixture Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="10",
        currency="EUR",
    )
    db_session.add(license_obj)
    await db_session.flush()
    document = Document(
        license_id=license_obj.id,
        filename="fixture-invoice.pdf",
        original_filename="fixture-invoice.pdf",
        file_size=256,
        mime_type="application/pdf",
        category=DocumentCategory.invoice,
    )
    db_session.add(document)
    await db_session.commit()

    restart = await test_app.post("/api/plugins/licensetrack-ai/runtime/restart", headers=auth_headers)
    assert restart.status_code == 200, restart.text
    assert restart.json()["health"] == "healthy"

    try:
        list_response = await test_app.get(
            "/api/plugin-actions",
            headers=auth_headers,
            params={
                "slot": "document.row.actions",
                "targetType": "license_document",
                "targetId": str(document.id),
            },
        )
        assert list_response.status_code == 200, list_response.text
        actions_body = list_response.json()["actions"]
        assert [action["actionKey"] for action in actions_body] == ["parseLicenseDocument"]

        invoke = await test_app.post(
            "/api/plugin-actions/licensetrack-ai/parseLicenseDocument/invoke",
            headers=auth_headers,
            json={
                "targetType": "license_document",
                "targetId": str(document.id),
                "context": {"documentId": document.id},
            },
        )
        assert invoke.status_code == 200, invoke.text
        invoke_body = invoke.json()
        assert invoke_body["status"] == "ok"
        assert invoke_body["suggestionsCreated"] == 1

        suggestion = await db_session.scalar(
            select(PluginSuggestion).where(
                PluginSuggestion.plugin_key == "licensetrack-ai",
                PluginSuggestion.action_key == "parseLicenseDocument",
                PluginSuggestion.target_type == "license",
                PluginSuggestion.target_id == str(license_obj.id),
            )
        )
        assert suggestion is not None
        assert suggestion.status == "pending"
        assert suggestion.suggested_fields[0]["field"] == "publisherName"

        accept = await test_app.post(
            f"/api/plugin-suggestions/{suggestion.id}/accept",
            headers=auth_headers,
            json={},
        )
        assert accept.status_code == 200, accept.text
        assert accept.json()["appliedFields"] == ["publisherName"]

        await db_session.refresh(license_obj)
        await db_session.refresh(suggestion)
        assert license_obj.publisher_name == "AI Parsed Publisher"
        assert suggestion.status == "accepted"
    finally:
        await stop_plugin_runtime(db_session, "licensetrack-ai")

from pathlib import Path
import textwrap

import pytest

import app.services.storage as _storage_module

from app.models.document import Document, DocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.schemas.plugin import PluginPermissionCreate, PluginRegistryCreate
from app.services import storage
from app.services.plugin_registry_service import create_plugin_registry_record
from app.services.plugin_runtime_service import (
    DOCUMENT_TYPE_LICENSE,
    PluginRuntimeActionTimeout,
    PluginRuntimeError,
    PopenManagedProcess,
    _build_runtime_environment,
    _runtime_command,
    _signal_process_tree,
    invoke_plugin_runtime_action,
    read_plugin_runtime_logs,
    read_scoped_runtime_document,
    register_runtime_action_scope,
    reset_stale_runtime_statuses,
    restart_plugin_runtime,
    stop_plugin_runtime,
    unregister_runtime_action_scope,
)


@pytest.fixture(autouse=True)
def enable_developer_plugin_host(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_ENABLED", True)
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)


def _runtime_script(*, health_status: str = "ok", slow_action: bool = False) -> str:
    slow_block = "time.sleep(2)" if slow_action else ""
    return textwrap.dedent(
        f"""
        import json
        import os
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import time

        TOKEN = os.environ["LT_PLUGIN_TOKEN"]
        PORT = int(os.environ["LT_PLUGIN_PORT"])

        class Handler(BaseHTTPRequestHandler):
            def _authorized(self):
                return self.headers.get("Authorization") == f"Bearer {{TOKEN}}"

            def _write(self, status, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if not self._authorized():
                    self._write(401, {{"status": "error"}})
                    return
                if self.path == "/health":
                    print("health checked with secret sk-runtime", flush=True)
                    self._write(200, {{"status": "{health_status}", "version": os.environ["LT_PLUGIN_VERSION"], "details": {{"settingsUrl": os.environ["LT_PLUGIN_SETTINGS_URL"]}}}})
                    return
                self._write(404, {{"status": "error"}})

            def do_POST(self):
                if not self._authorized():
                    self._write(401, {{"status": "error"}})
                    return
                if self.path == "/actions/parse_document":
                    {slow_block}
                    self._write(200, {{"status": "ok", "summary": "done"}})
                    return
                self._write(404, {{"status": "error"}})

            def log_message(self, format, *args):
                return

        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        """
    ).strip()


class _FakePopen:
    pid = 2468

    def poll(self):
        return None

    def terminate(self):
        pass

    def kill(self):
        pass

    def wait(self):
        return 0


def _payload(tmp_path: Path, *, script: str, key: str = "runtime-plugin", startup_timeout: int = 3) -> PluginRegistryCreate:
    install_path = tmp_path / key / "0.1.0"
    runtime_dir = install_path / "runtime"
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "test-plugin.py").write_text(script, encoding="utf-8")
    manifest = {
        "manifestVersion": 1,
        "key": key,
        "name": "Runtime Plugin",
        "version": "0.1.0",
        "publisher": {"name": "Tests"},
        "licenseTrack": {"minVersion": "1.0.0"},
        "runtime": {
            "type": "managedProcess",
            "entrypoint": "runtime/test-plugin.py",
            "healthPath": "/health",
            "actionsBasePath": "/actions",
            "startupTimeoutSeconds": startup_timeout,
            "timeoutSeconds": 1,
        },
        "permissions": ["actions:invoke"],
        "settings": [],
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
    return PluginRegistryCreate(
        key=key,
        name="Runtime Plugin",
        publisher_name="Tests",
        publisher_url=None,
        description=None,
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path=str(install_path),
        package_path=str(install_path / "package.zip"),
        checksum_sha256="b" * 64,
        manifest=manifest,
        permissions=[],
        settings=[],
        actions=[],
    )


async def test_restart_runtime_starts_health_checks_logs_and_stops(db_session, tmp_path):
    await create_plugin_registry_record(db_session, _payload(tmp_path, script=_runtime_script()))
    await db_session.commit()

    status = await restart_plugin_runtime(db_session, "runtime-plugin")
    await db_session.commit()

    assert status.health == "healthy"
    assert status.pid
    assert status.port
    assert status.log_path and Path(status.log_path).exists()
    assert status.process_metadata["health"]["details"]["settingsUrl"].endswith("/api/plugin-runtime/runtime-plugin/settings")

    logs = await read_plugin_runtime_logs(db_session, "runtime-plugin")
    assert "health checked" in logs.log

    stopped = await stop_plugin_runtime(db_session, "runtime-plugin")
    await db_session.commit()
    assert stopped.health == "stopped"
    assert stopped.pid is None
    assert stopped.port is None


async def test_runtime_environment_uses_explicit_allowlist(db_session, tmp_path, monkeypatch):
    plugin = await create_plugin_registry_record(db_session, _payload(tmp_path, script=""))
    monkeypatch.setenv("PATH", "runtime-path")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-leak")
    monkeypatch.setenv("LICENSETRACK_PRIVATE_VALUE", "must-not-leak")

    env = _build_runtime_environment(
        plugin=plugin,
        port=8123,
        token="runtime-token",
        log_dir=tmp_path / "logs",
    )

    assert env["PATH"] == "runtime-path"
    assert env["LT_PLUGIN_TOKEN"] == "runtime-token"
    assert "AWS_SECRET_ACCESS_KEY" not in env
    assert "LICENSETRACK_PRIVATE_VALUE" not in env


async def test_windows_process_shutdown_targets_full_process_tree(monkeypatch):
    calls = []

    def fake_run(command, **_kwargs):
        calls.append(command)

    monkeypatch.setattr("app.services.plugin_runtime_service.os.name", "nt")
    monkeypatch.setattr("app.services.plugin_runtime_service.subprocess.run", fake_run)
    process = PopenManagedProcess(_FakePopen())

    await _signal_process_tree(process, force=False)
    await _signal_process_tree(process, force=True)

    assert calls[0] == ["taskkill", "/PID", "2468", "/T"]
    assert calls[1] == ["taskkill", "/PID", "2468", "/T", "/F"]


async def test_runtime_health_failure_marks_error(db_session, tmp_path):
    await create_plugin_registry_record(
        db_session,
        _payload(tmp_path, script=_runtime_script(health_status="error"), key="bad-runtime", startup_timeout=1),
    )
    await db_session.commit()

    with pytest.raises(PluginRuntimeError, match="status=error"):
        await restart_plugin_runtime(db_session, "bad-runtime")

    plugin_status = await stop_plugin_runtime(db_session, "bad-runtime")
    assert plugin_status.health in {"error", "stopped"}


async def test_runtime_action_timeout_marks_error(db_session, tmp_path):
    await create_plugin_registry_record(
        db_session,
        _payload(tmp_path, script=_runtime_script(slow_action=True), key="slow-runtime"),
    )
    await db_session.commit()

    await restart_plugin_runtime(db_session, "slow-runtime")
    with pytest.raises(PluginRuntimeActionTimeout, match="timed out"):
        await invoke_plugin_runtime_action(
            db_session,
            "slow-runtime",
            "parse_document",
            {"requestId": "test"},
            timeout_seconds=1,
        )

    status = await stop_plugin_runtime(db_session, "slow-runtime")
    assert status.health in {"error", "stopped"}


async def test_read_scoped_document_rejects_oversized_file(db_session, tmp_path, monkeypatch):
    """Documents larger than MAX_PLUGIN_DOCUMENT_SIZE_MB must raise PluginRuntimeError."""
    import app.services.plugin_runtime_service as _runtime_module

    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    monkeypatch.setattr(_runtime_module.settings, "MAX_PLUGIN_DOCUMENT_SIZE_MB", 0)
    (tmp_path / "documents").mkdir(exist_ok=True)
    license_obj = License(
        license_type=LicenseType.perpetual,
        license_metric=LicenseMetric.per_user,
        publisher_name="Pub",
        software_description="SW",
        quantity="1",
    )
    db_session.add(license_obj)
    await db_session.flush()

    stored_path, file_size = storage.save_file_bytes(b"hello", "test.txt", license_obj.id)
    doc = Document(
        license_id=license_obj.id,
        filename=stored_path,
        original_filename="test.txt",
        mime_type="text/plain",
        file_size=file_size,
        category=DocumentCategory.other,
    )
    db_session.add(doc)
    await db_session.flush()
    plugin_payload = _payload(tmp_path, script="", key="test-plugin")
    plugin_payload.permissions = [PluginPermissionCreate(permission="documents:read", granted=True)]
    await create_plugin_registry_record(db_session, plugin_payload)
    await db_session.flush()

    register_runtime_action_scope("test-plugin", "req-1", {"documentId": doc.id})
    try:
        with pytest.raises(PluginRuntimeError, match="exceeds the maximum"):
            await read_scoped_runtime_document(
                db_session,
                plugin_key="test-plugin",
                request_id="req-1",
                document_type=DOCUMENT_TYPE_LICENSE,
                document_id=doc.id,
            )
    finally:
        unregister_runtime_action_scope("test-plugin", "req-1")


async def test_reset_stale_runtime_statuses_sets_stopped(db_session):
    """All non-stopped runtime statuses in DB must be reset to stopped on startup."""
    from app.models.plugin import Plugin, PluginRuntimeStatus

    plugin = Plugin(
        key="stale-test",
        name="Stale Test",
        publisher_name="Tests",
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path="/tmp/stale-test",
        manifest={},
        status="enabled",
        enabled=True,
    )
    db_session.add(plugin)
    await db_session.flush()

    status = PluginRuntimeStatus(plugin_id=plugin.id, health="healthy", pid=12345, port=54321)
    db_session.add(status)
    await db_session.flush()

    await reset_stale_runtime_statuses(db_session)
    await db_session.refresh(status)

    assert status.health == "stopped"
    assert status.pid is None
    assert status.port is None


def test_runtime_command_rejects_non_python_entrypoint(tmp_path):
    """_runtime_command must raise PluginRuntimeError for any non-.py entrypoint."""
    for bad_suffix in (".sh", ".exe", ".rb", ""):
        entrypoint = tmp_path / f"start{bad_suffix}"
        entrypoint.touch()
        with pytest.raises(PluginRuntimeError, match="not a Python file"):
            _runtime_command(entrypoint, {})


def test_runtime_command_returns_python_for_py_entrypoint(tmp_path):
    """_runtime_command must use sys.executable for .py entrypoints."""
    import sys
    entrypoint = tmp_path / "main.py"
    entrypoint.touch()
    cmd = _runtime_command(entrypoint, {})
    assert cmd[0] == sys.executable
    assert cmd[1] == str(entrypoint)

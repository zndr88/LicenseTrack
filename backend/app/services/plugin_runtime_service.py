from __future__ import annotations

import asyncio
import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.document import Document, ProcurementDocument
from app.models.plugin import Plugin, PluginRuntimeStatus, PluginSettingDefinition, PluginSettingValue
from app.models.sourcing import SourcingQuoteDocument
from app.schemas.plugin import (
    PluginRuntimeDocumentContentResponse,
    PluginRuntimeLogsResponse,
    PluginRuntimeSettingValue,
    PluginRuntimeSettingsResponse,
)
from app.services import storage
from app.services.crypto_service import decrypt_secret
from app.services.plugin_settings_service import read_plugin_settings
from app.services.plugin_host_service import ensure_plugin_can_run
from app.services.plugin_utils import int_list as _int_list, int_or_none as _int_or_none


class PluginRuntimeError(ValueError):
    """Raised when a plugin runtime cannot be managed safely."""


class PluginRuntimeAuthError(PluginRuntimeError):
    """Raised when a plugin runtime request fails authentication."""


class PluginRuntimeNotFoundError(PluginRuntimeError):
    """Raised when a referenced plugin is not installed."""


class PluginRuntimeActionTimeout(PluginRuntimeError):
    """Raised when a plugin action exceeds its effective timeout."""


@dataclass
class ManagedPluginProcess:
    process: Any
    token: str
    port: int
    log_path: str


class PopenManagedProcess:
    def __init__(self, process: subprocess.Popen[Any]) -> None:
        self._process = process

    @property
    def pid(self) -> int:
        return int(self._process.pid)

    @property
    def returncode(self) -> int | None:
        return self._process.poll()

    def terminate(self) -> None:
        self._process.terminate()

    def kill(self) -> None:
        self._process.kill()

    async def wait(self) -> int:
        return await asyncio.to_thread(self._process.wait)


# These module-level dicts are the authoritative in-process state for managed
# plugin subprocesses, their bearer tokens, and per-action document scopes.
#
# SINGLE-WORKER CONSTRAINT: This state is not shared across OS processes.
# LicenseTrack must run as a single Uvicorn worker (--workers 1, the default).
# Running multiple workers silently partitions plugin process management:
# worker A starts a subprocess and records its token; worker B cannot find it
# and will reject all runtime requests from that plugin with 401. Ensure your
# process manager (Docker, systemd, Electron) does not set --workers > 1.
_processes: dict[str, ManagedPluginProcess] = {}
_runtime_tokens: dict[str, str] = {}
_action_document_scopes: dict[tuple[str, str], set[tuple[str, int]]] = {}

DOCUMENT_TYPE_LICENSE = "license_document"
DOCUMENT_TYPE_PROCUREMENT = "procurement_document"
DOCUMENT_TYPE_SOURCING_QUOTE = "sourcing_quote_document"

RUNTIME_ENV_ALLOWLIST = frozenset(
    {
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "PYTHONHOME",
        "PYTHONPATH",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "LD_LIBRARY_PATH",
        "DYLD_LIBRARY_PATH",
    }
)


async def restart_plugin_runtime(db: AsyncSession, plugin_key: str) -> PluginRuntimeStatus:
    plugin = await _get_plugin(db, plugin_key)
    try:
        ensure_plugin_can_run(plugin)
    except ValueError as exc:
        raise PluginRuntimeError(str(exc)) from exc
    await stop_plugin_runtime(db, plugin_key, mark_stopped=False)
    await _ensure_runtime_ready(db, plugin)

    runtime = _runtime_manifest(plugin)
    port = _allocate_loopback_port()
    token = secrets.token_urlsafe(32)
    _runtime_tokens[plugin.key] = token
    install_path = Path(plugin.install_path).resolve()
    entrypoint = _resolve_entrypoint(install_path, runtime)
    log_dir = install_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "runtime.log"
    log_handle = log_path.open("ab")

    env = _build_runtime_environment(
        plugin=plugin,
        port=port,
        token=token,
        log_dir=log_dir,
    )

    command = _runtime_command(entrypoint, runtime)
    status = await _runtime_status_for(db, plugin.id)
    status.health = "starting"
    status.port = port
    status.pid = None
    status.log_path = str(log_path)
    status.last_error = None
    status.process_metadata = {
        "entrypoint": runtime.get("entrypoint"),
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    await db.flush()

    try:
        process = await _spawn_managed_process(command, install_path, env, log_handle)
    except Exception as exc:
        message = _runtime_exception_message("Runtime process failed to start", exc)
        status.health = "error"
        status.last_error = message
        await db.flush()
        raise PluginRuntimeError(message) from exc
    finally:
        log_handle.close()

    _processes[plugin.key] = ManagedPluginProcess(
        process=process,
        token=token,
        port=port,
        log_path=str(log_path),
    )
    status.pid = process.pid
    status.process_metadata = {
        **(status.process_metadata or {}),
        "pid": process.pid,
        "command": _redact_command(command),
    }
    await db.flush()

    try:
        await _wait_for_health(plugin, status, runtime, token, port)
    except Exception as exc:
        status.health = "error"
        status.last_error = str(exc)
        await db.flush()
        await _terminate_process(plugin.key)
        raise PluginRuntimeError(str(exc)) from exc

    await db.flush()
    return status


async def stop_plugin_runtime(
    db: AsyncSession, plugin_key: str, *, mark_stopped: bool = True
) -> PluginRuntimeStatus | None:
    status = None
    plugin = await _get_plugin_or_none(db, plugin_key)
    if plugin is not None:
        status = await _runtime_status_for(db, plugin.id)
    await _terminate_process(plugin_key)
    if status is not None and mark_stopped:
        status.pid = None
        status.port = None
        status.health = "stopped"
        status.last_error = None
        metadata = dict(status.process_metadata or {})
        metadata.pop("token", None)
        metadata["stoppedAt"] = datetime.now(timezone.utc).isoformat()
        status.process_metadata = metadata
        await db.flush()
    return status


async def reset_stale_runtime_statuses(db: AsyncSession) -> None:
    """Reset any plugin runtime DB rows that are not 'stopped' or 'unknown' to 'stopped'.

    Called once at application startup. The in-memory _processes dict is empty on a
    fresh start, so any row showing 'healthy', 'starting', or 'error' refers to a
    process that no longer exists. Resetting prevents the action-discovery filter
    (health == 'healthy') from returning stale results until the operator re-enables
    the plugin or triggers a restart from Admin Settings.
    """
    from sqlalchemy import update as sa_update
    from app.models.plugin import PluginRuntimeStatus as _PRS

    await db.execute(
        sa_update(_PRS).where(_PRS.health.notin_({"stopped", "unknown"})).values(health="stopped", pid=None, port=None)
    )
    await db.flush()


async def authenticate_plugin_runtime_request(db: AsyncSession, plugin_key: str, authorization: str | None) -> Plugin:
    plugin = await _get_plugin(db, plugin_key)
    status = await _runtime_status_for(db, plugin.id)
    token = _runtime_token(plugin.key, status)
    expected = f"Bearer {token}" if token else None
    if not expected or authorization != expected:
        raise PluginRuntimeAuthError("Plugin runtime token is invalid")
    if status.health not in {"starting", "healthy", "error"}:
        raise PluginRuntimeAuthError(f"Plugin '{plugin_key}' runtime is not active")
    return plugin


async def read_plugin_runtime_settings(db: AsyncSession, plugin_key: str) -> PluginRuntimeSettingsResponse:
    plugin = await _get_plugin(db, plugin_key)
    _require_granted_permission(plugin, "plugin:settings:read")
    definitions = await _setting_definitions(db, plugin.id)
    values_by_key = await _setting_values(db, plugin.id)
    missing_required: list[str] = []
    runtime_values: list[PluginRuntimeSettingValue] = []
    for definition in definitions:
        value_row = values_by_key.get(definition.setting_key)
        value = _decode_setting_value(definition, value_row)
        configured = _setting_is_configured(value)
        if definition.required and not configured:
            missing_required.append(definition.setting_key)
        runtime_values.append(
            PluginRuntimeSettingValue(
                key=definition.setting_key,
                value=value,
                required=definition.required,
                configured=configured,
            )
        )
    return PluginRuntimeSettingsResponse(
        plugin_key=plugin.key,
        values=runtime_values,
        missing_required=missing_required,
    )


def build_runtime_access_context(plugin_key: str, request_id: str, context: dict[str, Any]) -> dict[str, Any]:
    refs = _document_refs_from_context(context)
    base_url = settings.PLUGIN_HOST_BASE_URL.rstrip("/")
    document_refs = [
        {
            "type": document_type,
            "id": document_id,
            "contentUrl": f"{base_url}/api/plugin-runtime/{plugin_key}/action-requests/{request_id}/documents/{document_type}/{document_id}",
        }
        for document_type, document_id in refs
    ]
    return {
        **context,
        "runtimeAccess": {
            "settingsUrl": f"{base_url}/api/plugin-runtime/{plugin_key}/settings",
            "documentRefs": document_refs,
        },
    }


def register_runtime_action_scope(plugin_key: str, request_id: str, context: dict[str, Any]) -> None:
    _action_document_scopes[(plugin_key, request_id)] = set(_document_refs_from_context(context))


def unregister_runtime_action_scope(plugin_key: str, request_id: str) -> None:
    _action_document_scopes.pop((plugin_key, request_id), None)


async def read_scoped_runtime_document(
    db: AsyncSession,
    *,
    plugin_key: str,
    request_id: str,
    document_type: str,
    document_id: int,
) -> PluginRuntimeDocumentContentResponse:
    plugin = await _get_plugin(db, plugin_key)
    _require_granted_permission(plugin, "documents:read")
    scoped_refs = _action_document_scopes.get((plugin_key, request_id), set())
    if (document_type, document_id) not in scoped_refs:
        raise PluginRuntimeError("Document is not available in this plugin action context")

    if document_type == DOCUMENT_TYPE_LICENSE:
        document = await db.get(Document, document_id)
    elif document_type == DOCUMENT_TYPE_PROCUREMENT:
        document = await db.get(ProcurementDocument, document_id)
    elif document_type == DOCUMENT_TYPE_SOURCING_QUOTE:
        document = await db.get(SourcingQuoteDocument, document_id)
    else:
        raise PluginRuntimeError("Unsupported runtime document type")
    if document is None:
        raise PluginRuntimeError("Document not found")

    storage_base = await storage.resolve_storage_path(db)
    file_path = storage.get_file_path(document.filename, storage_base)
    if not file_path.exists():
        raise PluginRuntimeError("File not found on disk")
    max_bytes = settings.MAX_PLUGIN_DOCUMENT_SIZE_MB * 1024 * 1024
    file_size = file_path.stat().st_size
    if file_size > max_bytes:
        raise PluginRuntimeError(
            f"Document exceeds the maximum size of {settings.MAX_PLUGIN_DOCUMENT_SIZE_MB} MB "
            f"allowed for plugin access ({file_size} bytes)."
        )
    content = file_path.read_bytes()
    return PluginRuntimeDocumentContentResponse(
        document_type=document_type,
        document_id=document_id,
        file_name=document.original_filename,
        content_type=document.mime_type,
        size_bytes=len(content),
        content_base64=base64.b64encode(content).decode("ascii"),
        text=_decode_text_content(content, document.mime_type, document.original_filename),
    )


async def read_plugin_runtime_logs(db: AsyncSession, plugin_key: str) -> PluginRuntimeLogsResponse:
    plugin = await _get_plugin(db, plugin_key)
    status = await _runtime_status_for(db, plugin.id)
    max_bytes = max(1024, int(settings.PLUGIN_RUNTIME_LOG_MAX_BYTES))
    if not status.log_path:
        return PluginRuntimeLogsResponse(plugin_key=plugin.key, log="", truncated=False, max_bytes=max_bytes)

    log_path = Path(status.log_path)
    if not log_path.exists():
        return PluginRuntimeLogsResponse(plugin_key=plugin.key, log="", truncated=False, max_bytes=max_bytes)

    size = log_path.stat().st_size
    truncated = size > max_bytes
    with log_path.open("rb") as handle:
        if truncated:
            handle.seek(-max_bytes, os.SEEK_END)
        raw = handle.read()
    text = raw.decode("utf-8", errors="replace")
    return PluginRuntimeLogsResponse(
        plugin_key=plugin.key,
        log=_redact_log(text, await _redaction_values(db, plugin, status)),
        truncated=truncated,
        max_bytes=max_bytes,
    )


async def invoke_plugin_runtime_action(
    db: AsyncSession,
    plugin_key: str,
    handler: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: int | None = None,
) -> dict[str, Any]:
    plugin = await _get_plugin(db, plugin_key)
    try:
        ensure_plugin_can_run(plugin)
    except ValueError as exc:
        raise PluginRuntimeError(str(exc)) from exc
    status = await _runtime_status_for(db, plugin.id)
    runtime = _runtime_manifest(plugin)
    token = _runtime_token(plugin.key, status)
    port = status.port
    if status.health == "healthy" and (not token or not port):
        status = await restart_plugin_runtime(db, plugin.key)
        token = _runtime_token(plugin.key, status)
        port = status.port
    if not token or not port or status.health != "healthy":
        raise PluginRuntimeError(f"Plugin '{plugin_key}' runtime is not healthy")

    timeout = timeout_seconds or int(runtime.get("timeoutSeconds") or 30)
    try:
        return await _post_runtime_action(runtime, token, port, handler, payload, timeout)
    except httpx.TimeoutException as exc:
        status.health = "error"
        status.last_error = f"Plugin action '{handler}' timed out after {timeout} second(s)"
        await db.flush()
        raise PluginRuntimeActionTimeout(status.last_error) from exc
    except httpx.TransportError:
        status = await restart_plugin_runtime(db, plugin.key)
        token = _runtime_token(plugin.key, status)
        port = status.port
        if not token or not port or status.health != "healthy":
            raise PluginRuntimeError(f"Plugin '{plugin_key}' runtime is not healthy")
        try:
            return await _post_runtime_action(runtime, token, port, handler, payload, timeout)
        except httpx.TimeoutException as exc:
            status.health = "error"
            status.last_error = f"Plugin action '{handler}' timed out after {timeout} second(s)"
            await db.flush()
            raise PluginRuntimeActionTimeout(status.last_error) from exc
        except Exception as exc:
            status.health = "error"
            status.last_error = f"Plugin action '{handler}' failed after runtime restart: {exc}"
            await db.flush()
            raise PluginRuntimeError(status.last_error) from exc
    except Exception as exc:
        status.health = "error"
        status.last_error = f"Plugin action '{handler}' failed: {exc}"
        await db.flush()
        raise PluginRuntimeError(status.last_error) from exc


async def _post_runtime_action(
    runtime: dict,
    token: str,
    port: int,
    handler: str,
    payload: dict[str, Any],
    timeout: int,
) -> dict[str, Any]:
    url = f"http://127.0.0.1:{port}{runtime.get('actionsBasePath', '/actions').rstrip('/')}/{handler}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
    response.raise_for_status()
    return response.json()


async def _wait_for_health(
    plugin: Plugin,
    status: PluginRuntimeStatus,
    runtime: dict,
    token: str,
    port: int,
) -> None:
    startup_timeout = int(runtime.get("startupTimeoutSeconds") or 15)
    deadline = asyncio.get_running_loop().time() + startup_timeout
    last_error = "Runtime health check did not complete"
    while asyncio.get_running_loop().time() < deadline:
        process = _processes.get(plugin.key)
        if process and process.process.returncode is not None:
            raise PluginRuntimeError(
                f"Runtime exited before health check passed with code {process.process.returncode}"
            )
        try:
            health = await _health_check(runtime, token, port)
            if health.get("status") == "ok":
                status.health = "healthy"
                status.last_heartbeat_at = datetime.now(timezone.utc)
                status.last_error = None
                metadata = dict(status.process_metadata or {})
                metadata["health"] = health
                status.process_metadata = metadata
                return
            last_error = f"Runtime health returned status={health.get('status')}"
        except Exception as exc:
            last_error = str(exc)
        await asyncio.sleep(0.2)
    raise PluginRuntimeError(last_error)


async def _health_check(runtime: dict, token: str, port: int) -> dict[str, Any]:
    url = f"http://127.0.0.1:{port}{runtime.get('healthPath', '/health')}"
    async with httpx.AsyncClient(timeout=1.5) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise PluginRuntimeError("Runtime health response must be an object")
    return data


async def _ensure_runtime_ready(db: AsyncSession, plugin: Plugin) -> None:
    if plugin.status in {"incompatible", "uninstalled"} or plugin.compatibility_status == "incompatible":
        raise PluginRuntimeError(f"Plugin '{plugin.key}' cannot be started while {plugin.status}")
    settings_response = await read_plugin_settings(db, plugin.key)
    if settings_response.missing_required:
        status = await _runtime_status_for(db, plugin.id)
        status.health = "error"
        status.last_error = f"Missing required plugin setting(s): {', '.join(settings_response.missing_required)}"
        plugin.status = "misconfigured"
        plugin.enabled = False
        plugin.last_error = status.last_error
        await db.flush()
        raise PluginRuntimeError(status.last_error)


async def _get_plugin(db: AsyncSession, plugin_key: str) -> Plugin:
    plugin = await _get_plugin_or_none(db, plugin_key)
    if plugin is None:
        raise PluginRuntimeNotFoundError(f"Plugin '{plugin_key}' is not installed")
    return plugin


async def _get_plugin_or_none(db: AsyncSession, plugin_key: str) -> Plugin | None:
    result = await db.execute(
        select(Plugin)
        .options(
            selectinload(Plugin.runtime_status),
            selectinload(Plugin.setting_definitions),
            selectinload(Plugin.permissions),
        )
        .where(Plugin.key == plugin_key)
    )
    return result.scalar_one_or_none()


async def _runtime_status_for(db: AsyncSession, plugin_id: int) -> PluginRuntimeStatus:
    status = await db.scalar(select(PluginRuntimeStatus).where(PluginRuntimeStatus.plugin_id == plugin_id))
    if status is None:
        status = PluginRuntimeStatus(plugin_id=plugin_id, health="unknown")
        db.add(status)
        await db.flush()
    return status


def _runtime_manifest(plugin: Plugin) -> dict:
    runtime = (plugin.manifest or {}).get("runtime") or {}
    if runtime.get("type") != "managedProcess":
        raise PluginRuntimeError(f"Plugin '{plugin.key}' does not declare a managedProcess runtime")
    return runtime


def _resolve_entrypoint(install_path: Path, runtime: dict) -> Path:
    raw_entrypoint = str(runtime.get("entrypoint") or "")
    entrypoint = (install_path / raw_entrypoint).resolve()
    if install_path not in entrypoint.parents:
        raise PluginRuntimeError("Runtime entrypoint must stay inside the installed plugin directory")
    if not entrypoint.exists() or not entrypoint.is_file():
        raise PluginRuntimeError("Runtime entrypoint does not exist")
    return entrypoint


def _runtime_command(entrypoint: Path, runtime: dict) -> list[str]:
    if entrypoint.suffix.lower() != ".py":
        raise PluginRuntimeError(
            f"Runtime entrypoint '{entrypoint.name}' is not a Python file (.py). "
            "Only Python-based managed-process runtimes are supported in this version."
        )
    args = [str(arg) for arg in runtime.get("args") or []]
    return [sys.executable, str(entrypoint), *args]


def _build_runtime_environment(*, plugin: Plugin, port: int, token: str, log_dir: Path) -> dict[str, str]:
    base_url = settings.PLUGIN_HOST_BASE_URL.rstrip("/")
    env = {key: value for key, value in os.environ.items() if key.upper() in RUNTIME_ENV_ALLOWLIST}
    env.update(
        {
            "LT_PLUGIN_KEY": plugin.key,
            "LT_PLUGIN_VERSION": plugin.installed_version,
            "LT_PLUGIN_PORT": str(port),
            "LT_PLUGIN_TOKEN": token,
            "LT_PLUGIN_BASE_URL": base_url,
            "LT_PLUGIN_SETTINGS_URL": f"{base_url}/api/plugin-runtime/{plugin.key}/settings",
            "LT_PLUGIN_DOCUMENTS_BASE_URL": f"{base_url}/api/plugin-runtime/{plugin.key}",
            "LT_PLUGIN_LOG_DIR": str(log_dir),
        }
    )
    return env


async def _spawn_managed_process(
    command: list[str],
    install_path: Path,
    env: dict[str, str],
    log_handle: Any,
) -> Any:
    process_group_options = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if os.name == "nt"
        else {"start_new_session": True}
    )
    try:
        return await asyncio.create_subprocess_exec(
            *command,
            cwd=str(install_path),
            env=env,
            stdout=log_handle,
            stderr=asyncio.subprocess.STDOUT,
            **process_group_options,
        )
    except NotImplementedError:
        return PopenManagedProcess(
            subprocess.Popen(
                command,
                cwd=str(install_path),
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                **process_group_options,
            )
        )


def _runtime_exception_message(prefix: str, exc: Exception) -> str:
    detail = str(exc).strip() or exc.__class__.__name__
    return f"{prefix}: {detail}"


def _allocate_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


async def _terminate_process(plugin_key: str) -> None:
    _runtime_tokens.pop(plugin_key, None)
    managed = _processes.pop(plugin_key, None)
    if managed is None:
        return
    process = managed.process
    if process.returncode is not None:
        return
    await _signal_process_tree(process, force=False)
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except TimeoutError:
        await _signal_process_tree(process, force=True)
        await process.wait()


async def _signal_process_tree(process: Any, *, force: bool) -> None:
    is_managed_process = isinstance(process, (asyncio.subprocess.Process, PopenManagedProcess))
    if not is_managed_process:
        process.kill() if force else process.terminate()
        return

    if os.name == "nt":
        command = ["taskkill", "/PID", str(process.pid), "/T"]
        if force:
            command.append("/F")
        try:
            await asyncio.to_thread(
                subprocess.run,
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except OSError:
            process.kill() if force else process.terminate()
            return

    try:
        os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        process.kill() if force else process.terminate()


async def _redaction_values(db: AsyncSession, plugin: Plugin, status: PluginRuntimeStatus) -> list[str]:
    values: list[str] = []
    token = _runtime_token(plugin.key, status)
    if token:
        values.append(token)
    definitions = {definition.setting_key: definition for definition in await _setting_definitions(db, plugin.id)}
    result = await db.execute(select(PluginSettingValue).where(PluginSettingValue.plugin_id == plugin.id))
    for value in result.scalars().all():
        definition = definitions.get(value.setting_key)
        if definition is None or value.encrypted_value is None:
            continue
        try:
            decoded = (
                decrypt_secret(value.encrypted_value) if definition.setting_type == "secret" else value.encrypted_value
            )
        except Exception:
            continue
        if isinstance(decoded, str) and decoded:
            values.append(decoded)
    return values


async def _setting_definitions(db: AsyncSession, plugin_id: int) -> list[PluginSettingDefinition]:
    result = await db.execute(select(PluginSettingDefinition).where(PluginSettingDefinition.plugin_id == plugin_id))
    return list(result.scalars().all())


async def _setting_values(db: AsyncSession, plugin_id: int) -> dict[str, PluginSettingValue]:
    result = await db.execute(select(PluginSettingValue).where(PluginSettingValue.plugin_id == plugin_id))
    return {value.setting_key: value for value in result.scalars().all()}


def _decode_setting_value(definition: PluginSettingDefinition, value: PluginSettingValue | None):
    if value is None or value.encrypted_value is None:
        return None
    if definition.setting_type == "secret":
        return decrypt_secret(value.encrypted_value)
    try:
        return json.loads(value.encrypted_value)
    except json.JSONDecodeError:
        return value.encrypted_value


def _setting_is_configured(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _require_granted_permission(plugin: Plugin, permission_name: str) -> None:
    granted = {
        permission.permission
        for permission in plugin.permissions
        if getattr(permission, "granted", False)
    }
    if permission_name not in granted:
        raise PluginRuntimeError(f"Official Extension is missing required permission: {permission_name}")


def _document_refs_from_context(context: dict[str, Any]) -> list[tuple[str, int]]:
    refs: set[tuple[str, int]] = set()

    document_id = _int_or_none(context.get("documentId"))
    if document_id is not None:
        refs.add((DOCUMENT_TYPE_LICENSE, document_id))

    for document_id in _int_list(context.get("quoteDocumentIds")):
        refs.add((DOCUMENT_TYPE_SOURCING_QUOTE, document_id))

    for document_id in _int_list(context.get("purchaseOrderDocumentIds")):
        refs.add((DOCUMENT_TYPE_PROCUREMENT, document_id))

    target_type = context.get("targetType")
    generic_document_type = DOCUMENT_TYPE_LICENSE if target_type == "license_draft" else DOCUMENT_TYPE_PROCUREMENT
    for document_id in _int_list(context.get("documentIds")):
        refs.add((generic_document_type, document_id))

    linked = context.get("linkedSourcingContext") if isinstance(context.get("linkedSourcingContext"), dict) else {}
    for document_id in _int_list(linked.get("quoteDocumentIds")):
        refs.add((DOCUMENT_TYPE_SOURCING_QUOTE, document_id))

    line_items = context.get("lineItems") if isinstance(context.get("lineItems"), list) else []
    for item in line_items:
        if not isinstance(item, dict):
            continue
        linked_context = (
            item.get("linkedSourcingContext") if isinstance(item.get("linkedSourcingContext"), dict) else {}
        )
        for document_id in _int_list(linked_context.get("quoteDocumentIds")):
            refs.add((DOCUMENT_TYPE_SOURCING_QUOTE, document_id))

    return sorted(refs)


def _decode_text_content(content: bytes, mime_type: str, filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if mime_type.startswith("text/") or suffix in {".txt", ".csv", ".json", ".md"}:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("utf-8", errors="replace")
    return None


def _runtime_token(plugin_key: str, status: PluginRuntimeStatus) -> str | None:
    managed = _processes.get(plugin_key)
    if managed is not None:
        return managed.token
    token = _runtime_tokens.get(plugin_key)
    if token is not None:
        return token
    return _runtime_token_from_metadata(status)


def _runtime_token_from_metadata(status: PluginRuntimeStatus) -> str | None:
    metadata = status.process_metadata or {}
    token = metadata.get("token")
    return token if isinstance(token, str) else None


def _redact_log(text: str, values: list[str]) -> str:
    redacted = text
    for value in sorted(set(values), key=len, reverse=True):
        if value:
            redacted = redacted.replace(value, "[redacted]")
    return redacted


def _redact_command(command: list[str]) -> list[str]:
    return [Path(part).name if index == 0 else part for index, part in enumerate(command)]

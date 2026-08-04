from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User
from app.schemas.plugin import (
    PluginDetailResponse,
    PluginHostStatusResponse,
    PluginInstallPreview,
    PluginRuntimeLogsResponse,
    PluginRuntimeStatusResponse,
    PluginSettingsReadResponse,
    PluginSettingsUpdateRequest,
)
from app.services.audit_service import log_event
from app.services.plugin_package_service import (
    PluginPackageError,
    build_registry_payload,
    cleanup_installed_plugin_files,
    inspect_plugin_package,
    stage_and_extract_plugin_package,
)
from app.services.plugin_lifecycle_service import (
    PluginLifecycleError,
    disable_plugin,
    enable_plugin,
    uninstall_plugin,
)
from app.services.plugin_host_service import (
    plugin_developer_mode,
    plugin_host_enabled,
    require_plugin_host_enabled,
)
from app.services.plugin_registry_service import (
    PluginRegistryError,
    create_plugin_registry_record,
    get_plugin,
    list_plugins,
)
from app.services.plugin_runtime_service import (
    PluginRuntimeError,
    read_plugin_runtime_logs,
    restart_plugin_runtime,
)
from app.services.plugin_settings_service import PluginSettingsError, read_plugin_settings, update_plugin_settings
from app.services.plugin_signature_service import load_trusted_extension_keys

status_router = APIRouter(prefix="/api/plugins", tags=["official-extensions"])
router = APIRouter(
    prefix="/api/plugins",
    tags=["official-extensions"],
    dependencies=[Depends(require_plugin_host_enabled)],
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


@status_router.get("/status", response_model=PluginHostStatusResponse)
async def get_plugin_host_status(
    _admin: User = Depends(require_admin),
) -> PluginHostStatusResponse:
    trusted_keys, _issue = load_trusted_extension_keys()
    return PluginHostStatusResponse(
        enabled=plugin_host_enabled(),
        developer_mode=plugin_developer_mode(),
        trusted_key_count=len(trusted_keys),
    )


async def _read_plugin_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="File must be a .zip archive.")

    max_bytes = settings.MAX_PLUGIN_PACKAGE_SIZE_MB * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_PLUGIN_PACKAGE_SIZE_MB} MB.",
        )
    return content


@router.post("/preview-install", response_model=PluginInstallPreview)
async def preview_plugin_install(
    file: UploadFile,
    _admin: User = Depends(require_admin),
) -> PluginInstallPreview:
    content = await _read_plugin_upload(file)
    return inspect_plugin_package(content).preview


@router.post("/install", response_model=PluginDetailResponse, status_code=status.HTTP_201_CREATED)
async def install_plugin(
    file: UploadFile,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> PluginDetailResponse:
    content = await _read_plugin_upload(file)
    inspection = inspect_plugin_package(content)
    if not inspection.preview.installable:
        raise HTTPException(
            status_code=422,
            detail=inspection.preview.model_dump(mode="json", by_alias=True),
        )

    installed_files = None
    try:
        installed_files = stage_and_extract_plugin_package(inspection)
        payload = build_registry_payload(inspection, installed_files)
        plugin = await create_plugin_registry_record(db, payload)
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "plugin.installed",
            actor=admin,
            ip_address=ip,
            target_type="plugin",
            target_id=str(plugin.id),
            target_label=plugin.key,
            detail=(
                f"version={plugin.installed_version}\n"
                f"compatibilityStatus={plugin.compatibility_status}\n"
                f"checksumSha256={payload.checksum_sha256}"
            ),
        )
        await db.commit()
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except PluginPackageError as exc:
        raise HTTPException(status_code=422, detail=exc.preview.model_dump(mode="json", by_alias=True))
    except PluginRegistryError as exc:
        if installed_files is not None:
            cleanup_installed_plugin_files(installed_files)
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        if installed_files is not None:
            cleanup_installed_plugin_files(installed_files)
        await db.rollback()
        raise

    loaded = await get_plugin(db, plugin.key)
    if loaded is None:
        raise HTTPException(status_code=500, detail="Installed Official Extension could not be loaded.")
    return PluginDetailResponse.model_validate(loaded)


@router.get("", response_model=list[PluginDetailResponse])
async def list_installed_plugins(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[PluginDetailResponse]:
    return [PluginDetailResponse.model_validate(plugin) for plugin in await list_plugins(db)]


@router.get("/{plugin_key}/settings", response_model=PluginSettingsReadResponse)
async def get_plugin_settings(
    plugin_key: str,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> PluginSettingsReadResponse:
    try:
        return await read_plugin_settings(db, plugin_key)
    except PluginSettingsError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{plugin_key}/settings", response_model=PluginSettingsReadResponse)
async def update_installed_plugin_settings(
    plugin_key: str,
    payload: PluginSettingsUpdateRequest,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> PluginSettingsReadResponse:
    try:
        result = await update_plugin_settings(db, plugin_key, payload, updated_by=admin.id)
        ip = request.client.host if request.client else None
        if result.changed_keys:
            secret_note = f"\nsecretKeys={','.join(result.secret_keys)}" if result.secret_keys else ""
            await log_event(
                db,
                "plugin.settings.updated",
                actor=admin,
                ip_address=ip,
                target_type="plugin",
                target_id=plugin_key,
                target_label=plugin_key,
                detail=f"changedKeys={','.join(result.changed_keys)}{secret_note}",
            )
        await db.commit()
        return result.response
    except PluginSettingsError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 422
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{plugin_key}/enable", response_model=PluginDetailResponse)
async def enable_installed_plugin(
    plugin_key: str,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> PluginDetailResponse:
    try:
        plugin = await enable_plugin(db, plugin_key, actor_id=admin.id)
        ip = request.client.host if request.client else None
        granted = [permission.permission for permission in plugin.permissions if permission.granted]
        await log_event(
            db,
            "plugin.permissions.granted",
            actor=admin,
            ip_address=ip,
            target_type="plugin",
            target_id=str(plugin.id),
            target_label=plugin.key,
            detail=f"permissions={','.join(granted)}",
        )
        await log_event(
            db,
            "plugin.enabled",
            actor=admin,
            ip_address=ip,
            target_type="plugin",
            target_id=str(plugin.id),
            target_label=plugin.key,
            detail=f"version={plugin.installed_version}\nruntime={plugin.runtime_status.health if plugin.runtime_status else 'unknown'}",
        )
        await db.commit()
        return PluginDetailResponse.model_validate(plugin)
    except PluginLifecycleError as exc:
        # Commit (not rollback): the lifecycle service has already flushed the
        # error state (plugin.status="error", runtime.health="error") that we
        # want persisted so the admin can see why the enable attempt failed.
        await db.commit()
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 409
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{plugin_key}/disable", response_model=PluginDetailResponse)
async def disable_installed_plugin(
    plugin_key: str,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> PluginDetailResponse:
    try:
        plugin = await disable_plugin(db, plugin_key, actor_id=admin.id)
        await log_event(
            db,
            "plugin.disabled",
            actor=admin,
            ip_address=request.client.host if request.client else None,
            target_type="plugin",
            target_id=str(plugin.id),
            target_label=plugin.key,
            detail=f"version={plugin.installed_version}",
        )
        await db.commit()
        return PluginDetailResponse.model_validate(plugin)
    except PluginLifecycleError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 409
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{plugin_key}/runtime/restart", response_model=PluginRuntimeStatusResponse)
async def restart_installed_plugin_runtime(
    plugin_key: str,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> PluginRuntimeStatusResponse:
    try:
        runtime_status = await restart_plugin_runtime(db, plugin_key)
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "plugin.runtime.restarted",
            actor=admin,
            ip_address=ip,
            target_type="plugin",
            target_id=plugin_key,
            target_label=plugin_key,
            detail=f"health={runtime_status.health}\npid={runtime_status.pid}\nport={runtime_status.port}",
        )
        await db.commit()
        return PluginRuntimeStatusResponse.model_validate(runtime_status)
    except PluginRuntimeError as exc:
        await db.commit()
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 422
        raise HTTPException(status_code=status_code, detail=detail)


@router.get("/{plugin_key}/runtime/logs", response_model=PluginRuntimeLogsResponse)
async def get_installed_plugin_runtime_logs(
    plugin_key: str,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> PluginRuntimeLogsResponse:
    try:
        return await read_plugin_runtime_logs(db, plugin_key)
    except PluginRuntimeError as exc:
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 422
        raise HTTPException(status_code=status_code, detail=detail)


@router.delete("/{plugin_key}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def uninstall_installed_plugin(
    plugin_key: str,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> Response:
    try:
        await uninstall_plugin(db, plugin_key, actor_id=admin.id)
        await log_event(
            db,
            "plugin.uninstalled",
            actor=admin,
            ip_address=request.client.host if request.client else None,
            target_type="plugin",
            target_id=plugin_key,
            target_label=plugin_key,
        )
        await db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except PluginLifecycleError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not installed" in detail else 409
        raise HTTPException(status_code=status_code, detail=detail)


@router.get("/{plugin_key}", response_model=PluginDetailResponse)
async def get_installed_plugin(
    plugin_key: str,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> PluginDetailResponse:
    plugin = await get_plugin(db, plugin_key)
    if plugin is None:
        raise HTTPException(status_code=404, detail="Official Extension not found")
    return PluginDetailResponse.model_validate(plugin)

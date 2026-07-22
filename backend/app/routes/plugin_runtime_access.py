from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.plugin import PluginRuntimeDocumentContentResponse, PluginRuntimeSettingsResponse
from app.services.plugin_host_service import require_plugin_host_enabled
from app.services.plugin_runtime_service import (
    PluginRuntimeAuthError,
    PluginRuntimeError,
    PluginRuntimeNotFoundError,
    authenticate_plugin_runtime_request,
    read_plugin_runtime_settings,
    read_scoped_runtime_document,
)

router = APIRouter(
    prefix="/api/plugin-runtime",
    tags=["official-extension-runtime"],
    dependencies=[Depends(require_plugin_host_enabled)],
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/{plugin_key}/settings", response_model=PluginRuntimeSettingsResponse)
async def get_runtime_plugin_settings(
    plugin_key: str,
    db: DbSession,
    authorization: str | None = Header(default=None),
) -> PluginRuntimeSettingsResponse:
    try:
        await authenticate_plugin_runtime_request(db, plugin_key, authorization)
        return await read_plugin_runtime_settings(db, plugin_key)
    except PluginRuntimeAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except PluginRuntimeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except PluginRuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get(
    "/{plugin_key}/action-requests/{request_id}/documents/{document_type}/{document_id}",
    response_model=PluginRuntimeDocumentContentResponse,
)
async def get_runtime_scoped_document(
    plugin_key: str,
    request_id: str,
    document_type: str,
    document_id: int,
    db: DbSession,
    authorization: str | None = Header(default=None),
) -> PluginRuntimeDocumentContentResponse:
    try:
        await authenticate_plugin_runtime_request(db, plugin_key, authorization)
        return await read_scoped_runtime_document(
            db,
            plugin_key=plugin_key,
            request_id=request_id,
            document_type=document_type,
            document_id=document_id,
        )
    except PluginRuntimeAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except PluginRuntimeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except PluginRuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser
from app.schemas.plugin import PluginActionInvokeRequest, PluginActionInvokeResponse, PluginActionsListResponse
from app.services.audit_service import log_event
from app.services.plugin_action_service import PluginActionError, invoke_plugin_action, list_plugin_actions

router = APIRouter(prefix="/api/plugin-actions", tags=["plugin-actions"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=PluginActionsListResponse)
async def list_available_plugin_actions(
    db: DbSession,
    current_user: CurrentUser,
    slot: str = Query(..., min_length=1, max_length=120),
    target_type: str = Query(..., alias="targetType", min_length=1, max_length=80),
    target_id: str = Query(..., alias="targetId", min_length=1, max_length=120),
) -> PluginActionsListResponse:
    try:
        return await list_plugin_actions(db, slot=slot, target_type=target_type, target_id=target_id, actor=current_user)
    except PluginActionError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 422
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{plugin_key}/{action_key}/invoke", response_model=PluginActionInvokeResponse)
async def invoke_available_plugin_action(
    plugin_key: str,
    action_key: str,
    payload: PluginActionInvokeRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> PluginActionInvokeResponse:
    try:
        result = await invoke_plugin_action(
            db,
            plugin_key=plugin_key,
            action_key=action_key,
            target_type=payload.target_type,
            target_id=payload.target_id,
            client_context=payload.context,
            actor=current_user,
        )
        await log_event(
            db,
            "plugin.action.invoked",
            actor=current_user,
            ip_address=request.client.host if request.client else None,
            target_type=payload.target_type,
            target_id=payload.target_id,
            target_label=result.target_label,
            detail=result.audit_detail,
        )
        await db.commit()
        return result.response
    except PluginActionError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 409
        if "role cannot" in detail.lower():
            status_code = 403
        raise HTTPException(status_code=status_code, detail=detail)

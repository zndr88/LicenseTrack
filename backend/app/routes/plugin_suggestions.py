from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.user import User
from app.schemas.plugin_suggestion import (
    PluginSuggestionAcceptRequest,
    PluginSuggestionResponse,
    PluginSuggestionReviewResponse,
)
from app.services.audit_service import format_audit_detail, log_event
from app.services.plugin_host_service import plugin_host_enabled, require_plugin_host_enabled
from app.services.plugin_suggestion_service import (
    PluginSuggestionError,
    accept_plugin_suggestion,
    list_plugin_suggestions,
    reject_plugin_suggestion,
)

router = APIRouter(
    prefix="/api/plugin-suggestions",
    tags=["official-extension-suggestions"],
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[PluginSuggestionResponse])
async def list_pending_plugin_suggestions(
    db: DbSession,
    current_user: CurrentUser,
    license_id: int | None = Query(default=None, alias="licenseId"),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[PluginSuggestionResponse]:
    if not plugin_host_enabled():
        return []
    try:
        suggestions = await list_plugin_suggestions(
            db,
            actor=current_user,
            license_id=license_id,
            status_filter=status_filter,
        )
    except PluginSuggestionError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return [PluginSuggestionResponse.model_validate(row) for row in suggestions]


@router.post(
    "/{suggestion_id}/accept",
    response_model=PluginSuggestionReviewResponse,
    dependencies=[Depends(require_plugin_host_enabled)],
)
async def accept_pending_plugin_suggestion(
    suggestion_id: int,
    request: Request,
    db: DbSession,
    payload: PluginSuggestionAcceptRequest | None = None,
    current_user: User = Depends(require_editor_or_admin),
) -> PluginSuggestionReviewResponse:
    try:
        result = await accept_plugin_suggestion(
            db,
            suggestion_id=suggestion_id,
            actor=current_user,
            suggested_field_indexes=payload.suggested_field_indexes if payload else None,
        )
    except PluginSuggestionError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 409 if "already" in detail.lower() else 422
        raise HTTPException(status_code=status_code, detail=detail)

    suggestion = result.suggestion
    detail = format_audit_detail(
        "plugin_suggestion_acceptance",
        {
            "suggestionId": str(suggestion.id),
            "pluginKey": suggestion.plugin_key,
            "actionKey": suggestion.action_key,
            "targetType": suggestion.target_type,
            "targetId": suggestion.target_id,
            "reviewer": current_user.email,
            "appliedFields": ", ".join(result.applied_fields),
        },
        field_diffs=result.applied_changes,
    )
    await log_event(
        db,
        "plugin_suggestion.accepted",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="plugin_suggestion",
        target_id=str(suggestion.id),
        target_label=f"{suggestion.plugin_key}:{suggestion.action_key}",
        detail=detail,
    )
    if suggestion.license_id is not None:
        await log_event(
            db,
            "license.updated",
            actor=current_user,
            ip_address=request.client.host if request.client else None,
            target_type="license",
            target_id=str(suggestion.license_id),
            target_label=f"Plugin suggestion {suggestion.id}",
            detail=detail,
        )
    await db.commit()
    await db.refresh(suggestion)
    return PluginSuggestionReviewResponse(
        suggestion=PluginSuggestionResponse.model_validate(suggestion),
        applied_fields=result.applied_fields,
    )


@router.post(
    "/{suggestion_id}/reject",
    response_model=PluginSuggestionReviewResponse,
    dependencies=[Depends(require_plugin_host_enabled)],
)
async def reject_pending_plugin_suggestion(
    suggestion_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> PluginSuggestionReviewResponse:
    try:
        suggestion = await reject_plugin_suggestion(db, suggestion_id=suggestion_id, actor=current_user)
    except PluginSuggestionError as exc:
        await db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 409
        raise HTTPException(status_code=status_code, detail=detail)

    await log_event(
        db,
        "plugin_suggestion.rejected",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="plugin_suggestion",
        target_id=str(suggestion.id),
        target_label=f"{suggestion.plugin_key}:{suggestion.action_key}",
        detail=format_audit_detail(
            "plugin_suggestion_rejection",
            {
                "suggestionId": str(suggestion.id),
                "pluginKey": suggestion.plugin_key,
                "actionKey": suggestion.action_key,
                "targetType": suggestion.target_type,
                "targetId": suggestion.target_id,
                "reviewer": current_user.email,
            },
        ),
    )
    await db.commit()
    await db.refresh(suggestion)
    return PluginSuggestionReviewResponse(
        suggestion=PluginSuggestionResponse.model_validate(suggestion),
        applied_fields=[],
    )

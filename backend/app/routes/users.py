"""
User management routes.

GET    /api/users/me               — current user profile (any authenticated user)
GET    /api/users                  — list all users (admin only)
POST   /api/users                  — create user with role/provider (admin only)
PUT    /api/users/{id}             — update user profile/provider/role (admin only)
PUT    /api/users/{id}/role        — legacy role-only update (admin only)
PUT    /api/users/{id}/reset-password — reset local password (admin only)
DELETE /api/users/{id}             — delete user (admin only)
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.database import get_db
from app.dependencies import CurrentUser, require_admin
from app.models.api_token import ApiToken
from app.models.contract import Contract, ContractDocument
from app.models.document import Document, ProcurementDocument
from app.models.document_processing import DocumentProcessingResult
from app.models.extension import ExtensionCapability
from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.plugin import PluginPermission, PluginSettingValue
from app.models.plugin_suggestion import PluginSuggestion
from app.models.settings import GlobalSettings, UserSettings
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.user import AuthProvider, User
from app.models.user_department_access import UserDepartmentAccess
from app.models.webhook import WebhookEndpoint
from app.schemas.user import (
    DepartmentAssignment,
    ResetPasswordRequest,
    RoleUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.services.audit_service import diff_fields, log_event
from app.services.user_service import (
    apply_user_update,
    build_inherited_user_settings,
    ensure_local_admin_invariant,
    reject_break_glass_change,
)

router = APIRouter(prefix="/api/users", tags=["users"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[UserResponse]:
    result = await db.execute(select(User).order_by(User.id))
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    payload: UserCreate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> UserResponse:
    existing_username = await db.scalar(select(User).where(User.username == payload.username))
    if existing_username:
        raise HTTPException(status_code=409, detail="Username already taken")

    existing_email = await db.scalar(select(User).where(User.email == payload.email))
    if existing_email:
        raise HTTPException(status_code=409, detail="Email already in use")

    gs = await db.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    min_length = gs.password_min_length if gs else 12

    if payload.auth_provider == AuthProvider.local:
        if payload.password is None:
            raise HTTPException(
                status_code=422,
                detail="Password is required for local users.",
            )
        if len(payload.password) < min_length:
            raise HTTPException(
                status_code=422,
                detail=f"Password must be at least {min_length} characters",
            )
        hashed_password = auth.hash_password(payload.password)
        must_change_password = True
    else:
        hashed_password = auth.hash_password(secrets.token_urlsafe(32))
        must_change_password = False

    user = User(
        username=payload.username,
        email=str(payload.email),
        hashed_password=hashed_password,
        auth_provider=payload.auth_provider,
        role=payload.role,
        allow_downloads=payload.allow_downloads,
        must_change_password=must_change_password,
        is_break_glass_admin=False,
    )
    db.add(user)
    await db.flush()

    # New users inherit the creating admin's regional/display preferences.
    admin_settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == _admin.id))
    db.add(build_inherited_user_settings(user_id=user.id, source=admin_settings))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "user.created",
        actor=_admin,
        ip_address=ip,
        target_type="user",
        target_id=str(user.id),
        target_label=user.email,
    )
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> UserResponse:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    existing_username = await db.scalar(select(User).where(User.username == payload.username, User.id != user_id))
    if existing_username:
        raise HTTPException(status_code=409, detail="Username already taken")

    existing_email = await db.scalar(select(User).where(User.email == payload.email, User.id != user_id))
    if existing_email:
        raise HTTPException(status_code=409, detail="Email already in use")

    reject_break_glass_change(
        user,
        new_role=payload.role,
        new_auth_provider=payload.auth_provider,
        new_is_active=payload.is_active,
        new_username=payload.username,
    )
    await ensure_local_admin_invariant(
        db,
        target_user=user,
        new_role=payload.role,
        new_auth_provider=payload.auth_provider,
        new_is_active=payload.is_active,
    )

    gs = await db.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    min_length = gs.password_min_length if gs else 12
    if (
        payload.auth_provider == AuthProvider.local
        and user.auth_provider != AuthProvider.local
        and not payload.password
    ):
        raise HTTPException(status_code=422, detail="Password is required when converting an OIDC user to local login")

    before = {c.name: getattr(user, c.name) for c in user.__table__.columns}
    apply_user_update(
        user,
        username=payload.username,
        email=str(payload.email),
        role=payload.role,
        is_active=payload.is_active,
        allow_downloads=payload.allow_downloads,
        auth_provider=payload.auth_provider,
        password=payload.password,
        min_password_length=min_length,
    )
    after = {c.name: getattr(user, c.name) for c in user.__table__.columns}

    ip = request.client.host if request.client else None
    diff = diff_fields(before, after, {"hashed_password"})
    if diff:
        await log_event(
            db,
            "user.updated",
            actor=_admin,
            ip_address=ip,
            target_type="user",
            target_id=str(user.id),
            target_label=user.email,
            detail=diff,
        )

    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=204, response_class=Response)
async def delete_user(
    user_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_admin),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_break_glass_admin:
        raise HTTPException(status_code=400, detail="Break-glass admin cannot be deleted")

    await ensure_local_admin_invariant(
        db,
        target_user=user,
        new_role=user.role,
        new_auth_provider=user.auth_provider,
        new_is_active=False,
    )

    label = user.email

    await db.execute(delete(ApiToken).where(ApiToken.created_by == user_id))
    await db.execute(delete(UserDepartmentAccess).where(UserDepartmentAccess.user_id == user_id))
    await db.execute(delete(WebhookEndpoint).where(WebhookEndpoint.created_by == user_id))

    await db.execute(update(Contract).where(Contract.created_by == user_id).values(created_by=None))
    await db.execute(update(ContractDocument).where(ContractDocument.created_by == user_id).values(created_by=None))
    await db.execute(update(Document).where(Document.uploaded_by == user_id).values(uploaded_by=None))
    await db.execute(
        update(ProcurementDocument).where(ProcurementDocument.uploaded_by == user_id).values(uploaded_by=None)
    )
    await db.execute(update(License).where(License.created_by == user_id).values(created_by=None))
    await db.execute(update(SourcingRequest).where(SourcingRequest.created_by == user_id).values(created_by=None))
    await db.execute(
        update(SourcingQuoteDocument).where(SourcingQuoteDocument.uploaded_by == user_id).values(uploaded_by=None)
    )
    await db.execute(update(SourcingItem).where(SourcingItem.created_by == user_id).values(created_by=None))
    await db.execute(update(PendingOrder).where(PendingOrder.created_by == user_id).values(created_by=None))
    await db.execute(
        update(DocumentProcessingResult).where(DocumentProcessingResult.created_by == user_id).values(created_by=None)
    )
    await db.execute(
        update(DocumentProcessingResult).where(DocumentProcessingResult.reviewed_by == user_id).values(reviewed_by=None)
    )
    await db.execute(
        update(ExtensionCapability).where(ExtensionCapability.created_by == user_id).values(created_by=None)
    )
    await db.execute(
        update(ExtensionCapability).where(ExtensionCapability.updated_by == user_id).values(updated_by=None)
    )
    await db.execute(update(PluginPermission).where(PluginPermission.granted_by == user_id).values(granted_by=None))
    await db.execute(update(PluginSettingValue).where(PluginSettingValue.updated_by == user_id).values(updated_by=None))
    await db.execute(update(PluginSuggestion).where(PluginSuggestion.created_by == user_id).values(created_by=None))
    await db.execute(update(PluginSuggestion).where(PluginSuggestion.reviewed_by == user_id).values(reviewed_by=None))

    user_settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
    if user_settings is not None:
        await db.delete(user_settings)

    await db.delete(user)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "user.deleted",
        actor=current_user,
        ip_address=ip,
        target_type="user",
        target_id=str(user_id),
        target_label=label,
    )
    await db.commit()
    return Response(status_code=204)


@router.put("/{user_id}/reset-password", status_code=204, response_class=Response)
async def reset_user_password(
    user_id: int,
    payload: ResetPasswordRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_admin),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Use the change password form for your own account")
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.auth_provider == AuthProvider.oidc:
        raise HTTPException(status_code=400, detail="OIDC users do not use local passwords")

    gs = await db.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    min_length = gs.password_min_length if gs else 12
    if len(payload.new_password) < min_length:
        raise HTTPException(status_code=422, detail=f"Password must be at least {min_length} characters")
    user.hashed_password = auth.hash_password(payload.new_password)
    user.must_change_password = True

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "user.password_reset",
        actor=current_user,
        ip_address=ip,
        target_type="user",
        target_id=str(user_id),
        target_label=user.email,
    )
    await db.commit()
    return Response(status_code=204)


@router.put("/{user_id}/role", response_model=UserResponse)
async def update_user_role(
    user_id: int,
    payload: RoleUpdate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> UserResponse:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    reject_break_glass_change(
        user,
        new_role=payload.role,
        new_auth_provider=user.auth_provider,
        new_is_active=user.is_active,
    )
    await ensure_local_admin_invariant(
        db,
        target_user=user,
        new_role=payload.role,
        new_auth_provider=user.auth_provider,
        new_is_active=user.is_active,
    )

    old_role = user.role
    user.role = payload.role

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "user.role_changed",
        actor=_admin,
        ip_address=ip,
        target_type="user",
        target_id=str(user_id),
        target_label=user.email,
        detail=f"role: {old_role} → {payload.role}",
    )
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.get("/{user_id}/departments")
async def get_user_departments_route(
    user_id: int,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.execute(
        select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == user_id)
        .order_by(UserDepartmentAccess.department)
    )
    return [row[0] for row in result.all()]


@router.put("/{user_id}/departments")
async def update_user_departments(
    user_id: int,
    payload: DepartmentAssignment,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> dict:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    before_result = await db.execute(
        select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == user_id)
        .order_by(UserDepartmentAccess.department)
    )
    before_departments = sorted([row[0] for row in before_result.all()])
    after_departments = sorted(payload.departments)

    await db.execute(delete(UserDepartmentAccess).where(UserDepartmentAccess.user_id == user_id))
    for dept in payload.departments:
        db.add(UserDepartmentAccess(user_id=user_id, department=dept))

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "user.departments_updated",
        actor=_admin,
        ip_address=ip,
        target_type="user",
        target_id=str(user_id),
        target_label=user.email,
        detail=f"departments: {before_departments} → {after_departments}",
    )
    await db.commit()
    return {"departments": payload.departments}

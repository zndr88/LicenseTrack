"""
FastAPI dependency functions for authentication and role-based access control.

get_current_user  - extracts and validates the JWT from the Authorization header,
                    returns the authenticated User ORM object.
require_admin     - raises 403 unless the current user has the admin role.
require_editor_or_admin - raises 403 if the current user is a viewer.
"""

from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.config import settings
from app.database import get_db
from app.models.api_token import ApiToken
from app.models.user import User, UserRole
from app.services.audit_service import set_api_token_audit_context
from app.services.api_token_service import (
    API_TOKEN_PREFIX,
    decode_scopes,
    hash_api_token,
    hash_legacy_api_token,
    mark_token_used,
)

# auto_error=False so the dependency can also read the session cookie.
_bearer_scheme = HTTPBearer(auto_error=False)


PLUGIN_DOCUMENT_TARGET_TYPES = {"license_document"}
PLUGIN_LICENSE_TARGET_TYPES = {"license_draft"}
PLUGIN_PROCUREMENT_TARGET_TYPES = {
    "sourcing_item",
    "sourcing_quote_draft",
    "pending_order_draft",
    "pending_order_item",
    "pending_order_conversion",
}


async def _plugin_action_target_type(request: Request) -> str | None:
    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return request.query_params.get("targetType") or request.query_params.get("target_type")
    try:
        payload: Any = await request.json()
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload.get("targetType") or payload.get("target_type")


async def _required_api_token_scopes(request: Request) -> set[str] | None:
    """Return required API-token scopes, or None when the route does not support API tokens."""
    method = request.method.upper()
    path = request.url.path
    is_read = method in {"GET", "HEAD", "OPTIONS"}

    if path.startswith("/api/api-tokens"):
        return {"admin:tokens"}
    if path.startswith("/api/extensions"):
        return {"extensions:read"} if is_read else {"extensions:write"}
    if path.startswith("/api/reports"):
        return {"reports:read"} if is_read else None
    if path.startswith("/api/licenses"):
        if "/documents" in path:
            return {"documents:read"} if is_read else {"documents:write"}
        return {"licenses:read"} if is_read else {"licenses:write"}
    if path.startswith("/api/documents") or path.startswith("/api/procurement-documents"):
        return {"documents:read"} if is_read else {"documents:write"}
    if path.startswith("/api/document-actions"):
        return {"documents:read"} if is_read else {"documents:write"}
    if path.startswith("/api/plugin-actions"):
        target_type = await _plugin_action_target_type(request)
        if target_type in PLUGIN_PROCUREMENT_TARGET_TYPES:
            return {"documents:read", "procurement:read"} if is_read else {"documents:write", "procurement:write"}
        if target_type in PLUGIN_LICENSE_TARGET_TYPES:
            return {"licenses:read"} if is_read else {"licenses:write"}
        if target_type in PLUGIN_DOCUMENT_TARGET_TYPES:
            return {"documents:read"} if is_read else {"documents:write"}
        return {"documents:read"} if is_read else {"documents:write"}
    if path.startswith("/api/plugin-suggestions"):
        if path.endswith("/accept"):
            return {"licenses:write"}
        if path.endswith("/reject"):
            return {"licenses:write"}
        return {"licenses:read"} if is_read else {"licenses:write"}
    if path.startswith("/api/document-processing-results"):
        if path.endswith("/accept"):
            return {"documents:write", "licenses:write"}
        if path.endswith("/reject"):
            return {"documents:write"}
        return {"documents:read"} if is_read else {"documents:write", "extensions:write"}
    if path.startswith("/api/sourcing") or path.startswith("/api/pending-orders"):
        if any(segment in path for segment in ("/documents", "/quote-documents")):
            return {"documents:read", "procurement:read"} if is_read else {"documents:write", "procurement:write"}
        return {"procurement:read"} if is_read else {"procurement:write"}
    if path.startswith("/api/contracts"):
        if "/documents" in path:
            return {"documents:read"} if is_read else {"documents:write"}
        return {"licenses:read"} if is_read else {"licenses:write"}
    if path.startswith("/api/renewals"):
        return {"licenses:read"} if is_read else {"licenses:write"}
    if path.startswith("/api/custom-fields"):
        return {"licenses:read"} if is_read else {"licenses:write"}
    if path.startswith("/api/import"):
        return {"licenses:read"} if is_read else {"licenses:write"}
    return None


def _raise_invalid_token() -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Validate the Bearer token or session cookie and return the authenticated User."""
    token = credentials.credentials if credentials is not None else request.cookies.get(settings.SESSION_COOKIE_NAME)

    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if token.startswith(API_TOKEN_PREFIX):
        token_hash = hash_api_token(token)
        api_token = await db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash))
        if api_token is None:
            api_token = await db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_legacy_api_token(token)))
            if api_token is not None:
                api_token.token_hash = token_hash
        if api_token is None or api_token.revoked_at is not None:
            _raise_invalid_token()

        user = await db.scalar(select(User).where(User.id == api_token.created_by))
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token_scopes = set(decode_scopes(api_token))
        required_scopes = await _required_api_token_scopes(request)
        if required_scopes is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API tokens are not supported for this route",
            )
        if not required_scopes.issubset(token_scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API token missing required scope(s): {', '.join(sorted(required_scopes))}",
            )

        mark_token_used(api_token)
        await db.commit()
        request.state.api_token_id = api_token.id
        request.state.api_token_name = api_token.name
        request.state.api_token_scopes = sorted(token_scopes)
        set_api_token_audit_context({"id": api_token.id, "name": api_token.name})
        return user

    set_api_token_audit_context(None)
    try:
        payload = auth.decode_access_token(token)
    except auth.JWTError:
        _raise_invalid_token()

    user_id = int(payload["sub"])
    user = await db.scalar(select(User).where(User.id == user_id))

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# Convenience type alias for use in route signatures
CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(current_user: CurrentUser) -> User:
    """Raise 403 unless the current user is an admin."""
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def require_editor_or_admin(current_user: CurrentUser) -> User:
    """Raise 403 if the current user is a viewer."""
    if current_user.role == UserRole.viewer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Editor or admin access required",
        )
    return current_user

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.api_token import ApiToken
from app.models.user import User
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreateResponse, ApiTokenResponse
from app.services.api_token_service import (
    decode_scopes,
    encode_scopes,
    generate_api_token,
    get_token_prefix,
    hash_api_token,
)
from app.services.audit_service import log_event

router = APIRouter(prefix="/api/api-tokens", tags=["api-tokens"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _serialize_token(token: ApiToken, *, raw_token: str | None = None) -> ApiTokenResponse | ApiTokenCreateResponse:
    data = {
        "id": token.id,
        "name": token.name,
        "token_prefix": token.token_prefix,
        "scopes": decode_scopes(token),
        "created_by": token.created_by,
        "created_at": token.created_at,
        "last_used_at": token.last_used_at,
        "revoked_at": token.revoked_at,
    }
    if raw_token is not None:
        return ApiTokenCreateResponse(**data, token=raw_token)
    return ApiTokenResponse(**data)


@router.get("", response_model=list[ApiTokenResponse])
async def list_api_tokens(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[ApiTokenResponse]:
    result = await db.execute(select(ApiToken).order_by(ApiToken.created_at.desc(), ApiToken.id.desc()))
    return [_serialize_token(token) for token in result.scalars().all()]


@router.post("", response_model=ApiTokenCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_token(
    payload: ApiTokenCreate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> ApiTokenCreateResponse:
    raw_token = generate_api_token()
    token = ApiToken(
        name=payload.name.strip(),
        token_hash=hash_api_token(raw_token),
        token_prefix=get_token_prefix(raw_token),
        scopes=encode_scopes(payload.scopes),
        created_by=admin.id,
    )
    db.add(token)
    await db.flush()

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "api_token.created",
        actor=admin,
        ip_address=ip,
        target_type="api_token",
        target_id=str(token.id),
        target_label=token.name,
        detail=f"scopes: {decode_scopes(token)}",
    )
    await db.commit()
    await db.refresh(token)
    return _serialize_token(token, raw_token=raw_token)


@router.delete("/{token_id}", status_code=204, response_class=Response)
async def revoke_api_token(
    token_id: int,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> Response:
    token = await db.get(ApiToken, token_id)
    if token is None:
        raise HTTPException(status_code=404, detail="API token not found")
    if token.revoked_at is None:
        token.revoked_at = datetime.now(timezone.utc)
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "api_token.revoked",
            actor=admin,
            ip_address=ip,
            target_type="api_token",
            target_id=str(token.id),
            target_label=token.name,
        )
        await db.commit()
    return Response(status_code=204)

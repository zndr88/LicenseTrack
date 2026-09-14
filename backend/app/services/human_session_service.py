import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, update, func, or_
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.models.human_session import HumanSession
from app.models.user import User


def now_seconds() -> int:
    return int(datetime.now(timezone.utc).timestamp())


async def issue_session_token(
    db: AsyncSession,
    user: User,
    lifetime_minutes: int | None,
) -> str:
    """Create a fresh independently revocable login identity."""
    session_id = secrets.token_hex(32)
    await db.execute(
        delete(HumanSession).where(
            or_(
                (HumanSession.expires_at > 0) & (HumanSession.expires_at <= now_seconds()),
                (HumanSession.expires_at == 0) & (HumanSession.issued_at <= now_seconds()),
            )
        )
    )
    token = auth.create_access_token(
        user.id,
        user.role,
        security_version=user.security_version,
        lifetime_minutes=lifetime_minutes,
        session_id=session_id,
    )
    payload = auth.decode_access_token(token)
    db.add(
        HumanSession(
            id=session_id,
            user_id=user.id,
            security_version=user.security_version,
            issued_at=payload["iat"],
            expires_at=payload["exp"],
        )
    )
    await db.flush()
    return token


async def refresh_session_token(
    db: AsyncSession, user: User, lifetime_minutes: int | None, session_id: str, legacy_expiry: int | None = None
) -> str:
    if legacy_expiry is not None:
        await db.execute(
            insert(HumanSession)
            .values(
                id=session_id,
                user_id=user.id,
                security_version=user.security_version,
                issued_at=now_seconds(),
                expires_at=legacy_expiry,
            )
            .on_conflict_do_nothing()
        )
    token = auth.create_access_token(
        user.id,
        user.role,
        security_version=user.security_version,
        lifetime_minutes=lifetime_minutes,
        session_id=session_id,
    )
    payload = auth.decode_access_token(token)
    result = await db.execute(
        update(HumanSession)
        .where(
            HumanSession.id == session_id,
            HumanSession.user_id == user.id,
            HumanSession.expires_at > now_seconds(),
            HumanSession.security_version == user.security_version,
        )
        .values(issued_at=payload["iat"], expires_at=payload["exp"])
    )
    if result.rowcount != 1:
        raise auth.JWTError("Session ended")
    await db.commit()
    return token


async def get_active_session(db: AsyncSession, payload: dict, timeout_minutes: int, token: str) -> HumanSession | None:
    session_id = payload.get("session_id") or legacy_session_id(token)
    session = await db.get(HumanSession, session_id)
    if session is None and not payload.get("session_id"):
        return None
    if session is None or session.user_id != int(payload["sub"]):
        raise auth.JWTError("Session ended")
    expiry = session.expires_at
    if timeout_minutes > 0:
        expiry = min(expiry, session.issued_at + timeout_minutes * 60)
    if now_seconds() >= expiry:
        raise auth.JWTError("Session expired")
    return session


def legacy_session_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def revoke_session(db: AsyncSession, user_id: int, session_id: str, token_expiry: int) -> None:
    # Keep a tombstone through the last token expiry, including legacy JWTs.
    statement = insert(HumanSession).values(
        id=session_id, user_id=user_id, security_version=0, issued_at=token_expiry, expires_at=0
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[HumanSession.id],
            set_={
                "issued_at": func.max(HumanSession.issued_at, HumanSession.expires_at, token_expiry),
                "expires_at": 0,
            },
        )
    )
    await db.commit()


async def advance_session_security_version(
    db: AsyncSession, session_id: str, old_version: int, new_version: int
) -> None:
    await db.execute(
        update(HumanSession)
        .where(
            HumanSession.id == session_id,
            HumanSession.security_version == old_version,
            HumanSession.expires_at > now_seconds(),
        )
        .values(security_version=new_version)
    )

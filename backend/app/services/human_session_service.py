import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, insert, update, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.models.human_session import HumanSession
from app.models.user import User
from app.services.db_portability import greatest


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
    db: AsyncSession, user: User, lifetime_minutes: int | None, session_id: str
) -> str:
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


async def get_active_session(db: AsyncSession, payload: dict, timeout_minutes: int) -> HumanSession:
    session_id = payload["session_id"]
    session = await db.get(HumanSession, session_id)
    if session is None or session.user_id != int(payload["sub"]):
        raise auth.JWTError("Session ended")
    expiry = session.expires_at
    if timeout_minutes > 0:
        expiry = min(expiry, session.issued_at + timeout_minutes * 60)
    if now_seconds() >= expiry:
        raise auth.JWTError("Session expired")
    return session


async def revoke_session(db: AsyncSession, user_id: int, session_id: str, token_expiry: int) -> None:
    # Keep a tombstone through the last token expiry.
    mark_revoked = (
        update(HumanSession)
        .where(HumanSession.id == session_id)
        .values(
            issued_at=greatest(HumanSession.issued_at, HumanSession.expires_at, token_expiry),
            expires_at=0,
        )
        .execution_options(synchronize_session=False)
    )
    result = await db.execute(mark_revoked)
    if result.rowcount == 0:
        try:
            async with db.begin_nested():
                await db.execute(
                    insert(HumanSession).values(
                        id=session_id, user_id=user_id, security_version=0, issued_at=token_expiry, expires_at=0
                    )
                )
        except IntegrityError:
            # Another request created the row in between; revoke that one.
            await db.execute(mark_revoked)
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

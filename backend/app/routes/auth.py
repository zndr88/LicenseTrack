from collections import defaultdict
from datetime import datetime, timezone
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.dependencies import CurrentUser
from app.models.user import AuthProvider, User
from app.schemas.user import ChangePasswordRequest
from app.services.audit_service import log_event
from app.services.oidc_service import get_oidc_availability
from app.services.settings_service import get_global_settings
from app.services.user_service import bump_security_version

# Failed-login counters are tracked independently by username and by source IP.
# Keying only on username (as the original implementation did) let a password
# spray across many usernames bypass throttling entirely, and let a flood of
# unique usernames grow the counter dict without bound. Tracking the source IP
# as well throttles spraying, and the hard key cap bounds memory use.
_login_attempts_by_user: dict[str, list[float]] = defaultdict(list)
_login_attempts_by_ip: dict[str, list[float]] = defaultdict(list)
_MAX_ATTEMPTS_PER_USER = 5
_MAX_ATTEMPTS_PER_IP = 30
_WINDOW_SECONDS = 300
# Hard cap on tracked keys so a flood of unique usernames or IPs cannot grow the
# in-memory counters without bound (memory-exhaustion DoS protection).
_MAX_TRACKED_KEYS = 10_000


def _recent(store: dict[str, list[float]], key: str, now: float) -> list[float]:
    """Return the in-window timestamps for *key*, dropping the key when it empties."""
    recent = [t for t in store[key] if now - t < _WINDOW_SECONDS]
    if recent:
        store[key] = recent
    else:
        store.pop(key, None)
    return recent


def _prune_expired(store: dict[str, list[float]], now: float) -> None:
    """Drop every key whose attempts have all aged out of the window."""
    for key in list(store):
        _recent(store, key, now)


def _enforce_key_cap(store: dict[str, list[float]], now: float) -> None:
    """Drop expired keys, then evict the oldest active keys until the cap holds."""
    if len(store) <= _MAX_TRACKED_KEYS:
        return
    _prune_expired(store, now)
    while len(store) > _MAX_TRACKED_KEYS:
        store.pop(next(iter(store)), None)


def _check_rate_limit(username: str, ip: str | None) -> bool:
    """Return False when either the username or the source IP is over its threshold."""
    now = time()
    # Bound memory before doing any per-key work.
    _enforce_key_cap(_login_attempts_by_user, now)
    _enforce_key_cap(_login_attempts_by_ip, now)

    if len(_recent(_login_attempts_by_user, username, now)) >= _MAX_ATTEMPTS_PER_USER:
        return False
    if ip is not None and len(_recent(_login_attempts_by_ip, ip, now)) >= _MAX_ATTEMPTS_PER_IP:
        return False
    return True


def _record_attempt(username: str, ip: str | None) -> None:
    now = time()
    _login_attempts_by_user[username].append(now)
    if ip is not None:
        _login_attempts_by_ip[ip].append(now)
    _enforce_key_cap(_login_attempts_by_user, now)
    _enforce_key_cap(_login_attempts_by_ip, now)


def _clear_attempts(username: str) -> None:
    """Reset the successful username counter without clearing the IP spray bucket."""
    _login_attempts_by_user.pop(username, None)


# Pre-computed bcrypt hash used to equalise response timing when the supplied
# username does not exist, so an attacker cannot enumerate valid usernames by
# measuring how long a login attempt takes.
_DUMMY_PASSWORD_HASH = auth.hash_password("timing-equaliser-not-a-real-password")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/mode")
async def auth_mode(
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return frontend auth options. No auth required."""
    global_settings = await get_global_settings(db)
    oidc_enabled = bool(global_settings.oidc_enabled) if global_settings else False
    oidc_available = await get_oidc_availability(global_settings) if oidc_enabled else False
    return {
        "oidc_enabled": oidc_enabled,
        "oidc_available": oidc_available,
    }


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    allow_downloads: bool = True
    auth_provider: AuthProvider
    is_break_glass_admin: bool = False
    must_change_password: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class SessionResponse(BaseModel):
    authenticated: bool
    user: UserOut | None = None


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        role=user.role,
        allow_downloads=user.allow_downloads,
        auth_provider=user.auth_provider,
        is_break_glass_admin=user.is_break_glass_admin,
        must_change_password=user.must_change_password if user.auth_provider == AuthProvider.local else False,
    )


@router.get("/session", response_model=SessionResponse)
async def session(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """Return the current session state without treating anonymous users as an error."""
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        return SessionResponse(authenticated=False)

    try:
        payload = auth.decode_access_token(token)
        user_id = int(payload["sub"])
        token_version = int(payload.get("security_version", 0))
    except Exception:
        return SessionResponse(authenticated=False)

    user = await db.scalar(select(User).where(User.id == user_id))
    if (
        user is None
        or not user.is_active
        or token_version != int(user.security_version or 0)
    ):
        return SessionResponse(authenticated=False)
    gs = await get_global_settings(db)
    issued_at = int(payload.get("iat", 0) or 0)
    if gs and gs.session_timeout > 0:
        token_age = datetime.now(timezone.utc).timestamp() - issued_at
        if not issued_at or token_age < -60 or token_age > gs.session_timeout * 60:
            return SessionResponse(authenticated=False)

    return SessionResponse(authenticated=True, user=_user_out(user))


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    ip = request.client.host if request.client else None

    if not _check_rate_limit(body.username, ip):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a few minutes.",
        )

    user = await db.scalar(select(User).where(User.username == body.username))

    if user is not None and user.auth_provider == AuthProvider.oidc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses SSO. Use Sign in with SSO instead.",
        )

    if user is not None:
        password_valid = auth.verify_password(body.password, user.hashed_password) and user.is_active
    else:
        # Verify against a dummy hash so a missing user costs the same time as a
        # wrong password, closing the username-enumeration timing side channel.
        auth.verify_password(body.password, _DUMMY_PASSWORD_HASH)
        password_valid = False

    if not password_valid:
        _record_attempt(body.username, ip)
        # Log the failed attempt in a separate session so it commits even though
        # this request ends in a 401 (the injected session won't commit).
        try:
            async with AsyncSessionLocal() as audit_db:
                await log_event(
                    audit_db,
                    "auth.login_failed",
                    actor=None,
                    ip_address=ip,
                    target_type="user",
                    target_label=body.username,
                )
                await audit_db.commit()
        except Exception:
            pass  # Never let audit failures break authentication
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    _clear_attempts(body.username)
    gs = await get_global_settings(db)
    token = auth.create_access_token(
        user.id,
        user.role,
        security_version=user.security_version,
        lifetime_minutes=gs.session_timeout if gs and gs.session_timeout > 0 else None,
    )
    auth.set_session_cookie(response, token)

    await log_event(
        db,
        "auth.login",
        actor=user,
        ip_address=ip,
        target_type="user",
        target_id=str(user.id),
        target_label=user.email,
    )
    await db.commit()

    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=_user_out(user),
    )


@router.post("/logout", status_code=204, response_class=Response)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> Response:
    ip = request.client.host if request.client else None
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if token:
        try:
            payload = auth.decode_access_token(token)
            user_id = int(payload["sub"])
            user = await db.scalar(select(User).where(User.id == user_id))
            if user and user.is_active:
                await log_event(
                    db,
                    "auth.logout",
                    actor=user,
                    ip_address=ip,
                    target_type="user",
                    target_id=str(user.id),
                    target_label=user.email,
                )
                await db.commit()
        except Exception:
            pass  # Never let audit failures block logout
    auth.clear_session_cookie(response)
    return Response(
        status_code=204,
        headers=dict(response.headers),
    )


@router.post("/change-password", status_code=200)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    response: Response,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Change the authenticated user's own password."""
    if current_user.auth_provider == AuthProvider.oidc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OIDC users do not use local passwords",
        )
    if not auth.verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    gs = await get_global_settings(db)
    min_length = gs.password_min_length if gs else 12
    if len(body.new_password) < min_length:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {min_length} characters",
        )

    current_user.hashed_password = auth.hash_password(body.new_password)
    if current_user.must_change_password:
        current_user.must_change_password = False
    bump_security_version(current_user)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "auth.password_changed",
        actor=current_user,
        ip_address=ip,
        target_type="user",
        target_id=str(current_user.id),
        target_label=current_user.email,
    )
    await db.commit()
    session_token = auth.create_access_token(
        current_user.id,
        current_user.role,
        security_version=current_user.security_version,
        lifetime_minutes=gs.session_timeout if gs and gs.session_timeout > 0 else None,
    )
    auth.set_session_cookie(response, session_token)
    return {"access_token": session_token, "token_type": "bearer"}

import logging
from collections import defaultdict
from time import time
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.database import get_db
from app.models.user import AuthProvider, User
from app.services.audit_service import log_event
from app.services.crypto_service import decrypt_secret
from app.services.oidc_service import (
    authlib_available,
    get_oidc_metadata,
    oidc_is_configured,
    validate_oidc_fetch_url,
)
from app.services.settings_service import get_global_settings

router = APIRouter(prefix="/api/auth/oidc", tags=["auth"])

_oidc_attempts: dict[str, list[float]] = defaultdict(list)
_MAX_ATTEMPTS = 10
_WINDOW_SECONDS = 300


def _check_oidc_rate_limit(ip: str) -> bool:
    now = time()
    _oidc_attempts[ip] = [t for t in _oidc_attempts[ip] if now - t < _WINDOW_SECONDS]
    return len(_oidc_attempts[ip]) < _MAX_ATTEMPTS


def _record_oidc_attempt(ip: str) -> None:
    _oidc_attempts[ip].append(time())


logger = logging.getLogger(__name__)


def _allowed_frontend_origins() -> list[str]:
    return [origin.strip().rstrip("/") for origin in (auth.settings.CORS_ORIGINS or "").split(",") if origin.strip()]


def _fallback_frontend_url() -> str:
    origins = _allowed_frontend_origins()
    return f"{origins[0]}/" if origins else "http://localhost:5173/"


def _frontend_redirect_url(error: str | None = None) -> str:
    url = _fallback_frontend_url()
    if not error:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode({'error': error})}"


def _login_redirect(error: str | None = None) -> RedirectResponse:
    target = _frontend_redirect_url(error)
    response = RedirectResponse(url=target, status_code=302)
    auth.clear_oidc_flow_cookie(response)
    return response


def _safe_host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return urlparse(url).hostname
    except ValueError:
        return None


def _oidc_log_context(global_settings, discovery: dict | None = None) -> dict:
    return {
        "client_id": getattr(global_settings, "oidc_client_id", None),
        "discovery_host": _safe_host(getattr(global_settings, "oidc_discovery_url", None)),
        "issuer_host": _safe_host((discovery or {}).get("issuer")),
    }


def _log_oidc_callback_failure(
    stage: str,
    global_settings,
    *,
    discovery: dict | None = None,
    exc: Exception | None = None,
) -> None:
    context = _oidc_log_context(global_settings, discovery)
    logger.warning(
        "OIDC callback failed stage=%s client_id=%s discovery_host=%s issuer_host=%s",
        stage,
        context["client_id"],
        context["discovery_host"],
        context["issuer_host"],
        exc_info=exc,
    )


@router.get("/login")
async def oidc_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    global_settings = await get_global_settings(db)
    if not authlib_available() or not oidc_is_configured(global_settings):
        return _login_redirect("oidc_unavailable")

    try:
        metadata = await get_oidc_metadata(global_settings)
        from authlib.integrations.httpx_client import AsyncOAuth2Client

        state = auth.generate_oidc_state()
        nonce = auth.generate_oidc_nonce()
        redirect_uri = str(request.url_for("oidc_callback"))
        async with AsyncOAuth2Client(client_id=global_settings.oidc_client_id) as client:
            authorization_url, _ = client.create_authorization_url(
                metadata.discovery["authorization_endpoint"],
                redirect_uri=redirect_uri,
                scope="openid email profile",
                state=state,
                nonce=nonce,
            )
        response = RedirectResponse(url=authorization_url, status_code=302)
        auth.set_oidc_flow_cookie(response, state, nonce)
        return response
    except Exception:
        logger.warning("OIDC login initialisation failed", exc_info=True)
        return _login_redirect("oidc_unavailable")


@router.get("/callback")
async def oidc_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    ip = request.client.host if request.client else "unknown"
    if not _check_oidc_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    _record_oidc_attempt(ip)

    global_settings = await get_global_settings(db)
    if not authlib_available() or not oidc_is_configured(global_settings):
        return _login_redirect("oidc_unavailable")

    discovery = None
    try:
        flow_cookie = request.cookies.get(auth.OIDC_FLOW_COOKIE)
        if not flow_cookie:
            _log_oidc_callback_failure("missing_flow_cookie", global_settings)
            return _login_redirect("oidc_failed")

        try:
            flow = auth.parse_oidc_flow_cookie(flow_cookie)
        except Exception as exc:
            _log_oidc_callback_failure("invalid_state", global_settings, exc=exc)
            return _login_redirect("oidc_failed")

        state = request.query_params.get("state")
        code = request.query_params.get("code")
        if not state or state != flow.get("state"):
            _log_oidc_callback_failure("invalid_state", global_settings)
            return _login_redirect("oidc_failed")
        if not code:
            _log_oidc_callback_failure("missing_code", global_settings)
            return _login_redirect("oidc_failed")

        try:
            metadata = await get_oidc_metadata(global_settings)
        except Exception as exc:
            _log_oidc_callback_failure("metadata_fetch_failed", global_settings, exc=exc)
            return _login_redirect("oidc_failed")
        discovery = metadata.discovery
        from authlib.integrations.httpx_client import AsyncOAuth2Client
        from joserfc import jwk, jwt
        from joserfc.jwt import JWTClaimsRegistry

        redirect_uri = str(request.url_for("oidc_callback"))
        async with AsyncOAuth2Client(
            client_id=global_settings.oidc_client_id,
            client_secret=decrypt_secret(global_settings.oidc_client_secret),
        ) as client:
            try:
                token_endpoint = metadata.discovery["token_endpoint"]
                await validate_oidc_fetch_url(token_endpoint, purpose="OIDC token endpoint")
                token = await client.fetch_token(
                    token_endpoint,
                    grant_type="authorization_code",
                    code=code,
                    redirect_uri=redirect_uri,
                )
            except Exception as exc:
                _log_oidc_callback_failure(
                    "token_exchange_failed",
                    global_settings,
                    discovery=discovery,
                    exc=exc,
                )
                return _login_redirect("oidc_failed")

            id_token = token.get("id_token")
            if not id_token:
                _log_oidc_callback_failure("missing_id_token", global_settings, discovery=discovery)
                return _login_redirect("oidc_failed")

            try:
                claims = jwt.decode(id_token, jwk.KeySet.import_key_set(metadata.jwks)).claims
                JWTClaimsRegistry().validate(claims)
            except Exception as exc:
                _log_oidc_callback_failure(
                    "invalid_claims",
                    global_settings,
                    discovery=discovery,
                    exc=exc,
                )
                return _login_redirect("oidc_failed")
            if claims.get("iss") != metadata.discovery.get("issuer"):
                _log_oidc_callback_failure("invalid_issuer", global_settings, discovery=discovery)
                return _login_redirect("oidc_failed")
            audience = claims.get("aud")
            if isinstance(audience, str):
                audience = [audience]
            if global_settings.oidc_client_id not in (audience or []):
                _log_oidc_callback_failure("invalid_audience", global_settings, discovery=discovery)
                return _login_redirect("oidc_failed")
            if claims.get("nonce") != flow.get("nonce"):
                _log_oidc_callback_failure("invalid_nonce", global_settings, discovery=discovery)
                return _login_redirect("oidc_failed")

            email = claims.get("email")
            if not email and metadata.discovery.get("userinfo_endpoint"):
                try:
                    userinfo_endpoint = metadata.discovery["userinfo_endpoint"]
                    await validate_oidc_fetch_url(userinfo_endpoint, purpose="OIDC userinfo endpoint")
                    userinfo_response = await client.get(
                        userinfo_endpoint,
                        headers={"Authorization": f"Bearer {token['access_token']}"},
                    )
                    userinfo_response.raise_for_status()
                    email = userinfo_response.json().get("email")
                except Exception as exc:
                    _log_oidc_callback_failure(
                        "missing_email",
                        global_settings,
                        discovery=discovery,
                        exc=exc,
                    )
                    return _login_redirect("oidc_failed")

        if not email:
            _log_oidc_callback_failure("missing_email", global_settings, discovery=discovery)
            return _login_redirect("oidc_failed")

        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            _log_oidc_callback_failure("user_not_provisioned", global_settings, discovery=discovery)
            return _login_redirect("not_provisioned")
        if user.auth_provider == AuthProvider.local:
            _log_oidc_callback_failure("local_account", global_settings, discovery=discovery)
            return _login_redirect("local_account")
        if not user.is_active:
            _log_oidc_callback_failure("inactive_user", global_settings, discovery=discovery)
            return _login_redirect("oidc_failed")

        ip = request.client.host if request.client else None
        await log_event(
            db,
            "auth.oidc_login",
            actor=user,
            ip_address=ip,
            target_type="user",
            target_id=str(user.id),
            target_label=user.email,
        )
        await db.commit()

        response = RedirectResponse(url=_frontend_redirect_url(), status_code=302)
        auth.clear_oidc_flow_cookie(response)
        auth.set_session_cookie(response, auth.create_access_token(user.id, user.role))
        return response
    except Exception as exc:
        _log_oidc_callback_failure(
            "callback_failed",
            global_settings,
            discovery=discovery,
            exc=exc,
        )
        return _login_redirect("oidc_failed")

"""
auth.py - JWT utilities and password hashing.

NOT wired into routes as middleware yet. Import these functions directly
from the login route and any future protected routes.

JWT signing uses HS256 via Python stdlib (hmac + hashlib), which is
equivalent to python-jose for symmetric signing and avoids the cffi /
cryptography C-extension dependency in environments where it is unavailable.
python-jose remains in requirements.txt for production use; this stdlib
implementation is a compatible drop-in for HS256 tokens.
"""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import Response

from app.config import settings


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain* (truncated to 72 bytes, bcrypt's limit)."""
    plain_truncated = plain.encode()[:72]
    return bcrypt.hashpw(plain_truncated, bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches the bcrypt *hashed* password."""
    plain_truncated = plain.encode()[:72]
    return bcrypt.checkpw(plain_truncated, hashed.encode())


# ---------------------------------------------------------------------------
# JWT helpers (HS256, stdlib only)
# ---------------------------------------------------------------------------


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def _hs256_sign(signing_input: str, secret: str) -> bytes:
    return hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# Public JWT API
# ---------------------------------------------------------------------------


class JWTError(Exception):
    """Raised when a token cannot be decoded or has expired."""


SESSION_COOKIE_MAX_AGE = settings.TOKEN_EXPIRY * 60
OIDC_FLOW_COOKIE = "license_lifecycle_oidc_flow"


def create_access_token(user_id: int, role: str) -> str:
    """Return a signed HS256 JWT for *user_id* / *role*, expiring after TOKEN_EXPIRY minutes."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.TOKEN_EXPIRY)
    header = {"alg": "HS256", "typ": "JWT"}
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "exp": int(expire.timestamp()),
    }
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}"
    sig = _hs256_sign(signing_input, settings.JWT_SECRET)
    return f"{signing_input}.{_b64url_encode(sig)}"


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and verify *token*; raise JWTError on failure or expiry."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise JWTError("Malformed token")

        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}"

        expected_sig = _hs256_sign(signing_input, settings.JWT_SECRET)
        actual_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, actual_sig):
            raise JWTError("Invalid token signature")

        payload: dict[str, Any] = json.loads(_b64url_decode(payload_b64))

        if "exp" in payload:
            if datetime.now(timezone.utc).timestamp() > payload["exp"]:
                raise JWTError("Token has expired")

        return payload
    except JWTError:
        raise
    except Exception as exc:
        raise JWTError(f"Token decode error: {exc}") from exc


def _sign_payload(payload: dict[str, Any], secret: str) -> str:
    payload_json = json.dumps(payload, separators=(",", ":")).encode()
    payload_b64 = _b64url_encode(payload_json)
    sig = _hs256_sign(payload_b64, secret)
    return f"{payload_b64}.{_b64url_encode(sig)}"


def _verify_signed_payload(token: str, secret: str) -> dict[str, Any]:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = _hs256_sign(payload_b64, secret)
        actual_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, actual_sig):
            raise JWTError("Invalid signature")
        return json.loads(_b64url_decode(payload_b64))
    except JWTError:
        raise
    except Exception as exc:
        raise JWTError(f"Signed payload decode error: {exc}") from exc


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_COOKIE_MAX_AGE,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def build_oidc_flow_cookie(state: str, nonce: str) -> str:
    expires_at = int(datetime.now(timezone.utc).timestamp()) + 600
    payload: dict[str, Any] = {
        "state": state,
        "nonce": nonce,
        "exp": expires_at,
    }
    return _sign_payload(payload, settings.EFFECTIVE_OIDC_STATE_SECRET)


def parse_oidc_flow_cookie(token: str) -> dict[str, Any]:
    payload = _verify_signed_payload(token, settings.EFFECTIVE_OIDC_STATE_SECRET)
    if datetime.now(timezone.utc).timestamp() > payload.get("exp", 0):
        raise JWTError("OIDC flow state expired")
    return payload


def set_oidc_flow_cookie(response: Response, state: str, nonce: str) -> None:
    response.set_cookie(
        key=OIDC_FLOW_COOKIE,
        value=build_oidc_flow_cookie(state, nonce),
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
        max_age=600,
        path="/",
    )


def clear_oidc_flow_cookie(response: Response) -> None:
    response.delete_cookie(
        key=OIDC_FLOW_COOKIE,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def generate_oidc_state() -> str:
    return secrets.token_urlsafe(32)


def generate_oidc_nonce() -> str:
    return secrets.token_urlsafe(32)

import hashlib
import secrets
from datetime import datetime, timezone

from app.models.api_token import ApiToken

API_TOKEN_PREFIX = "lt_"


def generate_api_token() -> str:
    return f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_api_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_token_prefix(token: str) -> str:
    return token[:12]


def encode_scopes(scopes: list[str]) -> str:
    return " ".join(sorted(set(scopes)))


def decode_scopes(token: ApiToken) -> list[str]:
    return [scope for scope in token.scopes.split(" ") if scope]


def mark_token_used(token: ApiToken) -> None:
    token.last_used_at = datetime.now(timezone.utc)

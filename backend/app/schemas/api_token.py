from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ApiTokenScope = Literal[
    "licenses:read",
    "licenses:write",
    "procurement:read",
    "procurement:write",
    "documents:read",
    "documents:write",
    "reports:read",
    "extensions:read",
    "extensions:write",
]

ALLOWED_API_TOKEN_SCOPES: set[str] = set(ApiTokenScope.__args__)


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    scopes: list[ApiTokenScope]

    @field_validator("scopes")
    @classmethod
    def require_unique_scopes(cls, value: list[ApiTokenScope]) -> list[ApiTokenScope]:
        if not value:
            raise ValueError("At least one scope is required")
        return sorted(set(value))


class ApiTokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    token_prefix: str
    scopes: list[str]
    created_by: int
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiTokenCreateResponse(ApiTokenResponse):
    token: str

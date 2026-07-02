from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


CapabilityStatus = Literal["available", "unavailable", "misconfigured"]


class ExtensionCapabilityUpsert(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(min_length=1, max_length=150)
    capability_type: str = Field(min_length=1, max_length=100)
    status: CapabilityStatus = "available"
    version: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    health_url: str | None = Field(default=None, max_length=1000)
    last_error: str | None = Field(default=None, max_length=2000)
    details: dict | None = None

    @field_validator("capability_type")
    @classmethod
    def normalize_capability_type(cls, value: str) -> str:
        return value.strip()


class ExtensionCapabilityResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    key: str
    name: str
    capability_type: str
    status: str
    version: str | None
    description: str | None
    health_url: str | None
    last_error: str | None
    details: dict | None
    created_by: int | None
    updated_by: int | None
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime

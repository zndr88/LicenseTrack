from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class WebhookEndpointCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(min_length=1, max_length=150)
    url: str = Field(min_length=1, max_length=2000)
    events: list[str] = Field(default_factory=lambda: ["*"])
    is_active: bool = True

    @field_validator("url")
    @classmethod
    def require_http_url(cls, value: str) -> str:
        lowered = value.lower()
        if not lowered.startswith(("https://", "http://")):
            raise ValueError("Webhook URL must start with http:// or https://")
        return value

    @field_validator("events")
    @classmethod
    def normalize_events(cls, value: list[str]) -> list[str]:
        cleaned = sorted({event.strip() for event in value if event.strip()})
        if not cleaned:
            raise ValueError("At least one event is required")
        return cleaned


class WebhookEndpointUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str | None = Field(default=None, min_length=1, max_length=150)
    url: str | None = Field(default=None, min_length=1, max_length=2000)
    events: list[str] | None = None
    is_active: bool | None = None

    @field_validator("url")
    @classmethod
    def require_http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        lowered = value.lower()
        if not lowered.startswith(("https://", "http://")):
            raise ValueError("Webhook URL must start with http:// or https://")
        return value

    @field_validator("events")
    @classmethod
    def normalize_events(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = sorted({event.strip() for event in value if event.strip()})
        if not cleaned:
            raise ValueError("At least one event is required")
        return cleaned


class WebhookEndpointResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    name: str
    url: str
    events: list[str]
    is_active: bool
    created_by: int
    created_at: datetime
    updated_at: datetime
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


class WebhookEndpointCreateResponse(WebhookEndpointResponse):
    signing_secret: str


class WebhookDeliveryResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    endpoint_id: int
    event_type: str
    payload: dict
    status: str
    attempts: int
    next_attempt_at: datetime | None = None
    response_status: int | None = None
    response_body: str | None = None
    error: str | None = None
    created_at: datetime
    delivered_at: datetime | None = None

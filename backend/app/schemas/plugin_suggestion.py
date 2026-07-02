from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


PluginSuggestionStatus = Literal["pending", "accepted", "rejected", "superseded"]
PluginSuggestionTargetType = Literal[
    "license",
    "license_draft",
    "sourcing_item",
    "pending_order_item",
    "pending_order_conversion",
]


class PluginSuggestedField(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    field: str = Field(min_length=1, max_length=150)
    value: str | int | float | bool | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class PluginSuggestionLineItem(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    summary: str | None = Field(default=None, max_length=1000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)
    fields: list[PluginSuggestedField] = Field(default_factory=list)


class PluginSuggestionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    plugin_id: int | None
    plugin_key: str
    action_key: str
    target_type: PluginSuggestionTargetType
    target_id: str
    license_id: int | None
    status: PluginSuggestionStatus
    suggested_fields: list[PluginSuggestedField]
    line_items: list[PluginSuggestionLineItem]
    summary: str | None
    confidence: float | None
    raw_output: dict | None
    created_by: int | None
    created_at: datetime
    reviewed_by: int | None
    reviewed_at: datetime | None


class PluginSuggestionAcceptRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    suggested_field_indexes: list[int] | None = None


class PluginSuggestionReviewResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    suggestion: PluginSuggestionResponse
    applied_fields: list[str] = Field(default_factory=list)

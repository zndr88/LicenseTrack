from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


DocumentProcessingStatus = Literal["pending", "accepted", "rejected", "superseded"]


class SuggestedField(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    field: str = Field(min_length=1, max_length=150)
    value: str | int | float | bool | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class DocumentProcessingResultCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    document_type: str = Field(pattern="^(license_document|procurement_document)$")
    document_id: int
    capability_key: str = Field(min_length=1, max_length=150)
    suggested_fields: list[SuggestedField] = Field(min_length=1)
    summary: str | None = Field(default=None, max_length=2000)
    raw_output: dict | None = None
    error: str | None = Field(default=None, max_length=4000)


class DocumentProcessingResultResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    document_type: str
    document_id: int
    license_id: int | None
    capability_key: str
    status: DocumentProcessingStatus
    suggested_fields: list[SuggestedField]
    summary: str | None
    raw_output: dict | None
    error: str | None
    created_by: int | None
    created_at: datetime
    reviewed_by: int | None
    reviewed_at: datetime | None


class DocumentProcessingReviewResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    result: DocumentProcessingResultResponse
    applied_fields: list[str] = Field(default_factory=list)


class DocumentProcessingAcceptRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    suggested_field_indexes: list[int] | None = None

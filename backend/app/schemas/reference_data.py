from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ReferenceModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class OrganizationCreate(ReferenceModel):
    name: str = Field(min_length=1, max_length=255)
    is_publisher: bool = False
    is_supplier: bool = False


class OrganizationUpdate(ReferenceModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_publisher: bool | None = None
    is_supplier: bool | None = None


class OrganizationAliasCreate(ReferenceModel):
    name: str = Field(min_length=1, max_length=255)


class CostCentreCreate(ReferenceModel):
    name: str = Field(min_length=1, max_length=255)


class CostCentreUpdate(ReferenceModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)


class CostCentreAliasCreate(ReferenceModel):
    name: str = Field(min_length=1, max_length=255)


class MergeRequest(ReferenceModel):
    target_id: int = Field(gt=0)


class ReferenceAliasResponse(ReferenceModel):
    id: int
    name: str
    normalized_name: str
    created_at: datetime


class OrganizationUsage(ReferenceModel):
    licenses: int = 0
    contracts: int = 0
    sourcing_requests: int = 0
    sourcing_items: int = 0
    pending_orders: int = 0
    total: int = 0


class OrganizationResponse(ReferenceModel):
    id: int
    name: str
    normalized_name: str
    is_publisher: bool
    is_supplier: bool
    is_active: bool
    aliases: list[ReferenceAliasResponse] = Field(default_factory=list)
    usage: OrganizationUsage
    created_at: datetime
    updated_at: datetime


class OrganizationLookupResponse(ReferenceModel):
    id: int
    name: str
    normalized_name: str
    is_publisher: bool
    is_supplier: bool
    is_active: bool
    aliases: list[ReferenceAliasResponse] = Field(default_factory=list)


class CostCentreUsage(ReferenceModel):
    licenses: int = 0
    assigned_viewers: int = 0
    total: int = 0


class CostCentreResponse(ReferenceModel):
    id: int
    name: str
    normalized_name: str
    is_active: bool
    aliases: list[ReferenceAliasResponse] = Field(default_factory=list)
    usage: CostCentreUsage
    created_at: datetime
    updated_at: datetime


class CostCentreLookupResponse(ReferenceModel):
    id: int
    name: str
    normalized_name: str
    is_active: bool
    aliases: list[ReferenceAliasResponse] = Field(default_factory=list)


class MergePreviewResponse(ReferenceModel):
    source_id: int
    source_name: str
    target_id: int
    target_name: str
    source_usage: dict[str, int]


class MergeResponse(ReferenceModel):
    source_id: int
    target_id: int
    target_name: str
    affected: dict[str, int]

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from pydantic.alias_generators import to_camel

from app.models.custom_fields import CustomFieldRenewalBehavior

_BOOLEAN_ADAPTER = TypeAdapter(bool)


def _migrate_legacy_renewal_behavior(value: object) -> object:
    if not isinstance(value, dict):
        return value
    if "renewalBehavior" in value or "renewal_behavior" in value:
        return value
    legacy_value = value.get("carryForwardOnRenewal", value.get("carry_forward_on_renewal"))
    if legacy_value is not None:
        carry_forward = _BOOLEAN_ADAPTER.validate_python(legacy_value)
        return {
            **value,
            "renewalBehavior": (
                CustomFieldRenewalBehavior.copy.value
                if carry_forward
                else CustomFieldRenewalBehavior.clear.value
            ),
        }
    return value


class CustomFieldDefinitionCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    name: str = Field(..., min_length=1, max_length=255)
    field_type: str = Field(..., pattern="^(text|currency|date|boolean)$")
    display_order: int = Field(default=0, ge=0)
    renewal_behavior: CustomFieldRenewalBehavior = CustomFieldRenewalBehavior.clear

    _migrate_legacy_behavior = model_validator(mode="before")(_migrate_legacy_renewal_behavior)


class CustomFieldDefinitionUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    display_order: Optional[int] = Field(default=None, ge=0)
    section: Optional[str] = Field(
        default=None,
        pattern="^(identity|dates|commercial|people|documents|notes)$",
    )
    renewal_behavior: Optional[CustomFieldRenewalBehavior] = None

    _migrate_legacy_behavior = model_validator(mode="before")(_migrate_legacy_renewal_behavior)
    # field_type and field_key are immutable after creation - not included here


class CustomFieldDefinitionReorder(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    definition_ids: list[int] = Field(min_length=1)


class CustomFieldDefinitionResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    name: str
    field_key: str
    field_type: str
    display_order: int
    section: Optional[str] = None
    renewal_behavior: CustomFieldRenewalBehavior = CustomFieldRenewalBehavior.clear
    carry_forward_on_renewal: bool = False
    created_at: datetime
    updated_at: datetime


class CustomFieldValueItem(BaseModel):
    """Single field value within a bulk upsert payload."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    custom_field_def_id: int
    value_text: Optional[str | bool] = None
    value_currency: Optional[str] = None


class CustomFieldValuesUpsert(BaseModel):
    """Payload for PUT /api/licenses/{id}/custom-fields - replaces all values."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    values: list[CustomFieldValueItem]


class CustomFieldValueResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    license_id: int
    custom_field_def_id: int
    value_text: Optional[str]
    value_currency: Optional[str]
    # Include definition inline so frontend has name/type without a second request
    definition: CustomFieldDefinitionResponse


class CustomFieldValuesResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    values: list[CustomFieldValueResponse]


class CustomFieldDeleteResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    affected_licenses: int
    field_name: str

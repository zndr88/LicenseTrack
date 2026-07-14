from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.license import LicenseMetric, LicenseType, LifecycleStatus, MaintenanceCoverage
from app.schemas.custom_fields import CustomFieldValueResponse
from app.services.email_validation import reject_email_crlf
from app.services.money import is_canonical_money


def normalise_invoice_numbers(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise ValueError("Invoice numbers must be a list of strings.")

    numbers: list[str] = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if not text:
            continue
        if len(text) > 200:
            raise ValueError("Invoice numbers cannot exceed 200 characters.")
        numbers.append(text)
    return numbers


class LicenseBase(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    publisher_name: str
    software_description: str
    license_type: LicenseType
    license_metric: LicenseMetric
    quantity: str = ""
    sku_code: str = ""
    unit_price: str = ""
    total_po_price: str = ""
    currency: str = "EUR"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    contract_number: str = ""
    po_number: str = ""
    invoice_number: str = ""
    invoice_numbers: list[str] = Field(default_factory=list)
    pending_order_id: Optional[int] = None
    contact_email: str = ""
    supplier: str = ""
    cost_centre: str = ""
    budget_owner_email: str = ""
    portal_url: Optional[str] = None
    notes: Optional[str] = None
    has_maintenance: bool = False
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_cost: Optional[str] = None
    parent_license_id: Optional[int] = None
    active_maintenance_id: Optional[int] = None
    license_ref: Optional[str] = None
    external_ref: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    sync_status: Optional[str] = None
    is_retired: bool = False
    is_completeness_exempt: bool = False
    renewal_notifications_enabled: bool = True
    lifecycle_status: Optional[LifecycleStatus] = None
    renewed_from_id: Optional[int] = None
    renewed_to_id: Optional[int] = None
    coterm_from_ids: Optional[list[int]] = None

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def _normalise_blank_dates(cls, value: object) -> object:
        if value == "" or value == "Perpetual":
            return None
        return value

    @field_validator("quantity", "unit_price", "total_po_price", "maintenance_cost", mode="before")
    @classmethod
    def _validate_canonical_money(cls, v: object) -> object:
        if v is None or v == "":
            return v
        if isinstance(v, str) and not is_canonical_money(v):
            raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {v!r}.")
        return v

    @field_validator("budget_owner_email", mode="before")
    @classmethod
    def _reject_budget_owner_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)

    @field_validator("invoice_numbers", mode="before")
    @classmethod
    def _normalise_invoice_numbers(cls, value: object) -> list[str]:
        return normalise_invoice_numbers(value)


class LicenseCreate(LicenseBase):
    pass


class LicenseUpdate(BaseModel):
    """Partial update - all fields optional."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    publisher_name: Optional[str] = None
    software_description: Optional[str] = None
    license_type: Optional[LicenseType] = None
    license_metric: Optional[LicenseMetric] = None
    quantity: Optional[str] = None
    sku_code: Optional[str] = None
    unit_price: Optional[str] = None
    total_po_price: Optional[str] = None
    currency: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    request_date: Optional[datetime] = None
    purchase_date: Optional[datetime] = None
    contract_number: Optional[str] = None
    po_number: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_numbers: Optional[list[str]] = None
    pending_order_id: Optional[int] = None
    contact_email: Optional[str] = None
    supplier: Optional[str] = None
    cost_centre: Optional[str] = None
    budget_owner_email: Optional[str] = None
    portal_url: Optional[str] = None
    parent_license_id: Optional[int] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    notes: Optional[str] = None
    external_ref: Optional[str] = None
    sync_status: Optional[str] = None
    is_retired: Optional[bool] = None
    is_completeness_exempt: Optional[bool] = None
    renewal_notifications_enabled: Optional[bool] = None
    lifecycle_status: Optional[LifecycleStatus] = None
    renewed_from_id: Optional[int] = None
    renewed_to_id: Optional[int] = None
    predecessor_id: Optional[int] = None
    coterm_from_ids: Optional[list[int]] = None

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def _normalise_blank_dates(cls, value: object) -> object:
        if value == "" or value == "Perpetual":
            return None
        return value

    @field_validator("quantity", "unit_price", "total_po_price", mode="before")
    @classmethod
    def _validate_canonical_money(cls, v: object) -> object:
        if v is None or v == "":
            return v
        if isinstance(v, str) and not is_canonical_money(v):
            raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {v!r}.")
        return v

    @field_validator("budget_owner_email", mode="before")
    @classmethod
    def _reject_budget_owner_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)

    @field_validator("invoice_numbers", mode="before")
    @classmethod
    def _normalise_invoice_numbers(cls, value: object) -> list[str]:
        return normalise_invoice_numbers(value)


class LicenseLifecycleRepairRequest(BaseModel):
    """Admin-only repair payload for lifecycle and renewal-chain fields."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    lifecycle_status: Optional[LifecycleStatus] = None
    renewed_from_id: Optional[int] = None
    renewed_to_id: Optional[int] = None
    predecessor_id: Optional[int] = None
    coterm_from_ids: Optional[list[int]] = None
    reason: str = Field(min_length=1)


class LicenseResponse(LicenseBase):
    id: int
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    predecessor_id: Optional[int] = None
    request_date: Optional[datetime] = None
    purchase_date: Optional[datetime] = None

    # Computed fields - populated server-side, not stored in the database
    completeness_pct: Optional[int] = None
    days_until_expiry: Optional[int] = None
    expiration_status: Optional[str] = None
    document_count: int = 0
    custom_fields: list[CustomFieldValueResponse] = Field(default_factory=list)
    # Set only in convert responses: "renewed" | "new_purchase" | "renewed_predecessor"
    conversion_type: Optional[str] = None

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class FieldUpdateRequest(BaseModel):
    field: str
    value: str


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class CancelRenewalResponse(BaseModel):
    """Returned by POST /api/licenses/{id}/cancel-renewal."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    license: LicenseResponse
    po_warning: bool


class InitiateRenewalResponse(BaseModel):
    """Returned by POST /api/licenses/{id}/initiate-renewal."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    license: LicenseResponse
    sourcing_item: "SourcingItemResponse"


# Resolve forward reference - import after class definition to avoid circular imports
from app.schemas.sourcing import SourcingItemResponse  # noqa: E402

InitiateRenewalResponse.model_rebuild()

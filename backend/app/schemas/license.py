from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.license import (
    LicenseMetric,
    LicenseType,
    LifecycleStatus,
    MaintenanceCoverage,
    MaintenancePricingBasis,
)
from app.schemas.custom_fields import CustomFieldValueResponse
from app.services.email_validation import reject_email_crlf
from app.services.money import is_canonical_money
from app.services.procurement_totals import calculate_per_unit_support_total
from app.services.support_coverage_defaults import apply_bundled_included_support_defaults


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


def normalise_secondary_contacts(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise ValueError("Secondary contacts must be a list of strings.")

    contacts: list[str] = []
    seen: set[str] = set()
    for item in value:
        if item is None:
            continue
        text = reject_email_crlf(str(item))
        if not text:
            continue
        if len(text) > 255:
            raise ValueError("Secondary contacts cannot exceed 255 characters.")
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        contacts.append(text)
    return contacts


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
    quantity_per_unit: str = "1"
    sku_code: str = ""
    unit_price: str = ""
    total_po_price: str = ""
    currency: str = "EUR"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notice_date: Optional[date] = None
    contract_number: str = ""
    po_number: str = ""
    procurement_reference: str = ""
    invoice_number: str = ""
    invoice_numbers: list[str] = Field(default_factory=list)
    pending_order_id: Optional[int] = None
    contact_email: str = ""
    supplier: str = ""
    cost_centre: str = ""
    budget_owner_email: str = ""
    secondary_contacts: list[str] = Field(default_factory=list)
    portal_url: Optional[str] = None
    notes: Optional[str] = None
    has_maintenance: bool = False
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
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

    @field_validator("start_date", "end_date", "notice_date", mode="before")
    @classmethod
    def _normalise_blank_dates(cls, value: object) -> object:
        if value == "" or value == "Perpetual":
            return None
        return value

    @field_validator(
        "quantity",
        "quantity_per_unit",
        "unit_price",
        "total_po_price",
        "maintenance_quantity",
        "maintenance_unit_price",
        "maintenance_cost",
        mode="before",
    )
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

    @field_validator("secondary_contacts", mode="before")
    @classmethod
    def _normalise_secondary_contacts(cls, value: object) -> list[str]:
        return normalise_secondary_contacts(value)

    @model_validator(mode="after")
    def _normalise_included_support(self) -> "LicenseBase":
        data = self.model_dump(by_alias=False)
        if (
            self.maintenance_coverage == MaintenanceCoverage.included
            and self.maintenance_pricing_basis == MaintenancePricingBasis.per_unit
        ):
            data["maintenance_cost"] = calculate_per_unit_support_total(
                data.get("maintenance_quantity"),
                data.get("maintenance_unit_price"),
            )
        apply_bundled_included_support_defaults(data)
        for field in (
            "maintenance_start_date",
            "maintenance_end_date",
            "maintenance_pricing_basis",
            "maintenance_quantity",
            "maintenance_unit_price",
            "maintenance_cost",
        ):
            setattr(self, field, data.get(field))
        return self


class LicenseCreate(LicenseBase):
    pass


class LicenseBatchCreateItem(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    license: LicenseCreate
    parent_line_index: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _reject_ambiguous_parent(self) -> "LicenseBatchCreateItem":
        if self.parent_line_index is not None and self.license.parent_license_id is not None:
            raise ValueError("Use parentLineIndex or parentLicenseId, not both.")
        return self


class LicenseBatchCreateRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    items: list[LicenseBatchCreateItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _validate_parent_line_indexes(self) -> "LicenseBatchCreateRequest":
        for index, item in enumerate(self.items):
            if item.parent_line_index is not None and item.parent_line_index >= index:
                raise ValueError("parentLineIndex must refer to an earlier item in the same batch.")
        return self


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
    quantity_per_unit: Optional[str] = None
    sku_code: Optional[str] = None
    unit_price: Optional[str] = None
    total_po_price: Optional[str] = None
    currency: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notice_date: Optional[date] = None
    request_date: Optional[datetime] = None
    purchase_date: Optional[datetime] = None
    contract_number: Optional[str] = None
    po_number: Optional[str] = None
    procurement_reference: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_numbers: Optional[list[str]] = None
    pending_order_id: Optional[int] = None
    contact_email: Optional[str] = None
    supplier: Optional[str] = None
    cost_centre: Optional[str] = None
    budget_owner_email: Optional[str] = None
    secondary_contacts: Optional[list[str]] = None
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

    @field_validator("start_date", "end_date", "notice_date", mode="before")
    @classmethod
    def _normalise_blank_dates(cls, value: object) -> object:
        if value == "" or value == "Perpetual":
            return None
        return value

    @field_validator("quantity", "quantity_per_unit", "unit_price", "total_po_price", mode="before")
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

    @field_validator("secondary_contacts", mode="before")
    @classmethod
    def _normalise_secondary_contacts(cls, value: object) -> list[str]:
        return normalise_secondary_contacts(value)


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
    procurement_bundle_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_by_email: Optional[str] = None
    predecessor_id: Optional[int] = None
    request_date: Optional[datetime] = None
    purchase_date: Optional[datetime] = None
    source_sourcing_item_id: Optional[int] = None
    notice_handled_at: Optional[datetime] = None
    notice_handled_by_user_id: Optional[int] = None

    # Computed fields - populated server-side, not stored in the database
    effective_quantity: Optional[str] = None
    completeness_pct: Optional[int] = None
    days_until_expiry: Optional[int] = None
    expiration_status: Optional[str] = None
    document_count: int = 0
    available_document_count: int = 0
    missing_document_count: int = 0
    unavailable_document_count: int = 0
    custom_fields: list[CustomFieldValueResponse] = Field(default_factory=list)
    # Set only in convert responses: "renewed" | "new_purchase" |
    # "direct_freeware" | "renewed_predecessor"
    conversion_type: Optional[str] = None

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    @model_validator(mode="after")
    def _calculate_effective_quantity(self) -> "LicenseResponse":
        if self.effective_quantity is not None:
            return self
        if not self.quantity:
            return self
        try:
            quantity = Decimal(self.quantity)
            quantity_per_unit = Decimal(self.quantity_per_unit or "1")
        except InvalidOperation:
            return self
        self.effective_quantity = format(quantity * quantity_per_unit, "f")
        return self


class ProcurementTrailDocument(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: int
    original_filename: str
    category: str
    uploaded_at: datetime


class ProcurementTrailSourcingRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: int
    status: str
    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    quote_documents: list[ProcurementTrailDocument] = Field(default_factory=list)


class ProcurementTrailSourcingItem(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: int
    status: str
    publisher_name: str
    software_description: str
    quantity: Optional[str] = None
    estimated_unit_price: Optional[str] = None
    estimated_total_price: Optional[str] = None
    currency: str = "EUR"
    renewal_for_license_id: Optional[int] = None
    coterm_predecessor_ids: Optional[list[int]] = None


class ProcurementTrailPendingOrder(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: int
    po_number: str
    procurement_reference: str = ""
    status: str
    supplier: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    documents: list[ProcurementTrailDocument] = Field(default_factory=list)


class ProcurementTrailConversion(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    pending_order_id: Optional[int] = None
    source_sourcing_item_id: Optional[int] = None
    source_match_type: str = "none"
    request_date: Optional[datetime] = None
    purchase_date: Optional[datetime] = None
    renewed_from_id: Optional[int] = None
    predecessor_id: Optional[int] = None
    coterm_from_ids: Optional[list[int]] = None


class LicenseProcurementTrailResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    license_id: int
    license_ref: Optional[str] = None
    sourcing_request: Optional[ProcurementTrailSourcingRequest] = None
    sourcing_item: Optional[ProcurementTrailSourcingItem] = None
    pending_order: Optional[ProcurementTrailPendingOrder] = None
    conversion: ProcurementTrailConversion


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


class InitiateRenewalBundleRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    license_ids: list[int] = Field(min_length=2)


class InitiateRenewalBundleResponse(BaseModel):
    """Returned by POST /api/licenses/renewal-bundle/initiate."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    licenses: list[LicenseResponse]
    sourcing_request: "SourcingRequestResponse"


# Resolve forward reference - import after class definition to avoid circular imports
from app.schemas.sourcing import SourcingItemResponse, SourcingRequestResponse  # noqa: E402

InitiateRenewalResponse.model_rebuild()
InitiateRenewalBundleResponse.model_rebuild()

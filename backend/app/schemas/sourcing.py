from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.license import LicenseType, MaintenanceCoverage, MaintenancePricingBasis
from app.models.sourcing import SourcingStatus
from app.services.money import is_canonical_money


class SourcingItemCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    publisher_name: str
    software_description: str
    license_type: Optional[LicenseType] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
    maintenance_cost: Optional[str] = None
    parent_sourcing_item_id: Optional[int] = None
    parent_item_index: Optional[int] = None
    quantity: Optional[str] = None
    estimated_unit_price: Optional[str] = None
    estimated_total_price: Optional[str] = None
    currency: str = "EUR"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    status: SourcingStatus = SourcingStatus.sourcing
    renewal_for_license_id: Optional[int] = None
    sourcing_request_id: Optional[int] = None

    @field_validator(
        "quantity",
        "estimated_unit_price",
        "estimated_total_price",
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

class SourcingItemUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    publisher_name: Optional[str] = None
    software_description: Optional[str] = None
    license_type: Optional[LicenseType] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
    maintenance_cost: Optional[str] = None
    parent_sourcing_item_id: Optional[int] = None
    quantity: Optional[str] = None
    estimated_unit_price: Optional[str] = None
    estimated_total_price: Optional[str] = None
    currency: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[SourcingStatus] = None

    @field_validator(
        "quantity",
        "estimated_unit_price",
        "estimated_total_price",
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

class SourcingItemResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    sourcing_request_id: Optional[int] = None
    publisher_name: str
    software_description: str
    license_type: Optional[LicenseType] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
    maintenance_cost: Optional[str] = None
    parent_sourcing_item_id: Optional[int] = None
    quantity: Optional[str] = None
    estimated_unit_price: Optional[str] = None
    estimated_total_price: Optional[str] = None
    currency: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    status: SourcingStatus
    pending_order_id: Optional[int] = None
    pending_order_status: Optional[str] = None
    pending_order_po_number: Optional[str] = None
    converted_license_id: Optional[int] = None
    converted_license_ref: Optional[str] = None
    converted_license_retired: bool = False
    converted_license_ids: list[int] = []
    renewal_for_license_id: Optional[int] = None
    coterm_predecessor_ids: Optional[list[int]] = None
    is_renewal: bool = False
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None

    @model_validator(mode="after")
    def _set_is_renewal(self) -> "SourcingItemResponse":
        self.is_renewal = self.renewal_for_license_id is not None
        return self


class CotermMergeRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    sourcing_item_ids: list[int]


class SourcingRequestCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    items: list[SourcingItemCreate]


class SourcingRequestItemUpdate(BaseModel):
    """Editable request line fields submitted with one atomic request update."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: int
    publisher_name: Optional[str] = None
    software_description: Optional[str] = None
    license_type: Optional[LicenseType] = None
    quantity: Optional[str] = None
    estimated_unit_price: Optional[str] = None
    estimated_total_price: Optional[str] = None
    currency: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("quantity", "estimated_unit_price", "estimated_total_price", mode="before")
    @classmethod
    def _validate_canonical_money(cls, value: object) -> object:
        if value is None or value == "":
            return value
        if isinstance(value, str) and not is_canonical_money(value):
            raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {value!r}.")
        return value


class SourcingRequestUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[list[SourcingRequestItemUpdate]] = None


class SourcingQuoteDocumentResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    sourcing_request_id: int
    filename: str
    original_filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: Optional[int] = None
    file_availability: Literal["available", "missing", "unavailable"] = "available"


class SourcingRequestResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    supplier: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    status: SourcingStatus
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    items: list[SourcingItemResponse] = []
    quote_documents: list[SourcingQuoteDocumentResponse] = []
    total_estimated_value: Optional[str] = None

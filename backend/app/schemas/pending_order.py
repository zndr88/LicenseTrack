from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.license import LicenseMetric, LicenseType, MaintenanceCoverage, MaintenancePricingBasis
from app.models.pending_order import EvidenceTransferStatus, PendingOrderStatus
from app.services.email_validation import reject_email_crlf
from app.services.money import is_canonical_money
from app.services.procurement_totals import calculate_per_unit_support_total
from app.services.support_coverage_defaults import apply_bundled_included_support_defaults
from app.schemas.document import ProcurementDocumentResponse
from app.schemas.sourcing import SourcingQuoteDocumentResponse
from app.schemas.sourcing import SourcingItemCreate


_CURRENCY_SYMBOLS: dict[str, str] = {
    "EUR": "€",
    "USD": "$",
    "GBP": "£",
}


def _format_currency(amount: Decimal, currency: str) -> str:
    symbol = _CURRENCY_SYMBOLS.get(currency, currency + "\u00a0")
    return f"{symbol}{amount:,.2f}"


class SourcingItemSummary(BaseModel):
    """Minimal sourcing item representation nested inside a PendingOrderResponse."""

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
    status: str
    renewal_for_license_id: Optional[int] = None
    coterm_predecessor_ids: Optional[list[int]] = None
    quote_documents: list[SourcingQuoteDocumentResponse] = []
    is_renewal: bool = False
    converted_license_id: Optional[int] = None
    converted_license_ref: Optional[str] = None
    converted_license_retired: bool = False
    converted_license_ids: list[int] = []

    @model_validator(mode="after")
    def _set_is_renewal(self) -> "SourcingItemSummary":
        self.is_renewal = self.renewal_for_license_id is not None
        return self


class PendingOrderCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    po_number: str = ""
    procurement_reference: str = ""
    supplier: Optional[str] = None
    notes: Optional[str] = None
    items: list[SourcingItemCreate] = []


class PendingOrderUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    po_number: Optional[str] = None
    procurement_reference: Optional[str] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[PendingOrderStatus] = None


class PendingOrderResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    po_number: str
    procurement_reference: str = ""
    supplier: Optional[str] = None
    notes: Optional[str] = None
    status: PendingOrderStatus
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    evidence_transfer_status: Optional[EvidenceTransferStatus] = None
    evidence_transfer_detail: Optional[str] = None
    evidence_transfer_failed_at: Optional[datetime] = None
    items: list[SourcingItemSummary] = []
    documents: list[ProcurementDocumentResponse] = []
    total_po_value: Optional[str] = None
    converted_license_id: Optional[int] = None
    converted_license_ref: Optional[str] = None
    converted_license_retired: bool = False
    converted_license_ids: list[int] = []
    direct_registry_count: int = 0

    @model_validator(mode="after")
    def _compute_total_po_value(self) -> "PendingOrderResponse":
        from app.services.procurement_totals import procurement_line_total

        totals: dict[str, Decimal] = {}
        for item in self.items:
            line_total = procurement_line_total(item)
            if line_total is not None:
                totals[item.currency] = totals.get(item.currency, Decimal("0")) + line_total
        if not totals:
            self.total_po_value = None
        else:
            parts = [_format_currency(amt, cur) for cur, amt in totals.items()]
            self.total_po_value = " + ".join(parts)
        return self


class PendingOrderConvertRequest(BaseModel):
    """License fields submitted when converting a pending order to a live license."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    # Required
    publisher_name: str
    software_description: str

    # Classification - defaulted so the form can omit them if not changed
    license_type: LicenseType = LicenseType.subscription
    license_metric: LicenseMetric = LicenseMetric.per_user
    portal_url: Optional[str] = None
    parent_license_id: Optional[int] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
    maintenance_cost: Optional[str] = None

    # Pricing / quantity
    quantity: str = ""
    quantity_per_unit: str = "1"
    sku_code: str = ""
    unit_price: str = ""
    total_po_price: str = ""
    currency: str = "EUR"

    # Dates
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    purchase_date: Optional[date] = None

    # References
    contract_number: str = ""
    po_number: str = ""
    procurement_reference: str = ""
    invoice_number: str = ""

    # Contact / ownership
    contact_email: str = ""
    supplier: str = ""
    cost_centre: str = ""
    budget_owner_email: str = ""

    notes: Optional[str] = None

    @field_validator("start_date", "end_date", "purchase_date", mode="before")
    @classmethod
    def _normalise_date(cls, v: object) -> object:
        """Accept ISO dates, DD/MM/YYYY strings, empty strings, and None."""
        if v is None or v == "":
            return None
        if not isinstance(v, str):
            return v
        # Already ISO YYYY-MM-DD
        parts = v.split("-")
        if len(parts) == 3 and len(parts[0]) == 4:
            return v
        # DD/MM/YYYY or DD/MM/YY
        slash_parts = v.split("/")
        if len(slash_parts) == 3:
            return f"{slash_parts[2]}-{slash_parts[1].zfill(2)}-{slash_parts[0].zfill(2)}"
        return v

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
    def _coerce_none_to_empty(cls, v: object) -> object:
        """Coerce None → empty string, numbers → string."""
        if v is None:
            return ""
        if isinstance(v, (int, float)):
            # Preserve meaningful decimals, strip trailing zeros
            return str(int(v)) if isinstance(v, float) and v == int(v) else str(v)
        return v

    @field_validator(
        "quantity",
        "quantity_per_unit",
        "unit_price",
        "total_po_price",
        "maintenance_quantity",
        "maintenance_unit_price",
        "maintenance_cost",
        mode="after",
    )
    @classmethod
    def _validate_canonical_money(cls, v: str) -> str:
        if v == "":
            return v
        if not is_canonical_money(v):
            raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {v!r}.")
        return v

    @model_validator(mode="after")
    def _normalise_included_support(self) -> "PendingOrderConvertRequest":
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

    @field_validator("budget_owner_email", mode="before")
    @classmethod
    def _reject_budget_owner_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)


class ConvertSourcingItemRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    po_number: Optional[str] = None
    procurement_reference: Optional[str] = None
    pending_order_id: Optional[int] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None


class BatchConvertItem(BaseModel):
    """License payload for a single sourcing item in a batch conversion."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    sourcing_item_id: int

    # Required
    publisher_name: str
    software_description: str

    # Classification
    license_type: LicenseType = LicenseType.subscription
    license_metric: LicenseMetric = LicenseMetric.per_user
    portal_url: Optional[str] = None
    parent_license_id: Optional[int] = None
    parent_sourcing_item_id: Optional[int] = None
    maintenance_coverage: Optional[MaintenanceCoverage] = None
    maintenance_start_date: Optional[date] = None
    maintenance_end_date: Optional[date] = None
    maintenance_pricing_basis: Optional[MaintenancePricingBasis] = None
    maintenance_quantity: Optional[str] = None
    maintenance_unit_price: Optional[str] = None
    maintenance_cost: Optional[str] = None

    # Pricing / quantity
    quantity: str = ""
    quantity_per_unit: str = "1"
    sku_code: str = ""
    unit_price: str = ""
    total_po_price: str = ""
    currency: str = "EUR"

    # Dates
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    purchase_date: Optional[date] = None

    # References
    contract_number: str = ""
    po_number: str = ""
    procurement_reference: str = ""
    invoice_number: str = ""

    # Contact / ownership
    contact_email: str = ""
    supplier: str = ""
    cost_centre: str = ""
    budget_owner_email: str = ""

    notes: Optional[str] = None

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
    def _coerce_none_to_empty(cls, v: object) -> object:
        """Coerce None → empty string, numbers → string."""
        if v is None:
            return ""
        if isinstance(v, (int, float)):
            # Preserve meaningful decimals, strip trailing zeros
            return str(int(v)) if isinstance(v, float) and v == int(v) else str(v)
        return v

    @field_validator(
        "quantity",
        "quantity_per_unit",
        "unit_price",
        "total_po_price",
        "maintenance_quantity",
        "maintenance_unit_price",
        "maintenance_cost",
        mode="after",
    )
    @classmethod
    def _validate_canonical_money(cls, v: str) -> str:
        if v == "":
            return v
        if not is_canonical_money(v):
            raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {v!r}.")
        return v

    @model_validator(mode="after")
    def _normalise_included_support(self) -> "BatchConvertItem":
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

    @field_validator("budget_owner_email", mode="before")
    @classmethod
    def _reject_budget_owner_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)


# Type alias: the convert-all endpoint accepts a JSON array of BatchConvertItem
BatchConvertRequest = list[BatchConvertItem]

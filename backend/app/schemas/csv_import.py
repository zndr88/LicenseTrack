from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator
from pydantic.alias_generators import to_camel

from app.services.email_validation import reject_email_crlf


class ColumnMatch(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_header: str
    internal_field: str
    sample_values: list[str]


class UnrecognizedColumn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_header: str
    sample_values: list[str]


class CSVAnalyzeResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    total_rows: int
    matched_columns: list[ColumnMatch]
    unrecognized_columns: list[UnrecognizedColumn]
    missing_required: list[str]


class MappingEntry(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    raw_header: str
    target: str  # internal field name, "cf_*" key, or "skip"


class ImportMappingCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str
    mapping: list[MappingEntry]


class ImportMappingResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    name: str
    mapping: list[MappingEntry]
    created_at: datetime
    updated_at: datetime


class ImportExecuteRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    mapping: list[MappingEntry]
    mapping_name: Optional[str] = None  # if set, save mapping before executing


class ImportReferenceOverride(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    candidate_key: str = Field(min_length=1, max_length=512)
    action: str = Field(pattern="^(accept_new|map_existing|keep_separate)$")
    target_id: Optional[int] = Field(default=None, gt=0)
    target_name: Optional[str] = Field(default=None, max_length=255)
    display_name: Optional[str] = Field(default=None, max_length=255)


class ImportReferenceMatch(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: Optional[int] = None
    candidate_key: Optional[str] = None
    name: str
    is_active: bool


class ImportReferenceCandidate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    kind: str
    role_usage: list[str] = Field(default_factory=list)
    candidate_key: str
    proposed_name: str
    source_spellings: list[str] = Field(default_factory=list)
    occurrence_count: int
    sample_row_numbers: list[int] = Field(default_factory=list)
    status: str
    matched: Optional[ImportReferenceMatch] = None
    possible_matches: list[ImportReferenceMatch] = Field(default_factory=list)


class ImportReferenceCounts(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    matched: int = 0
    new: int = 0
    possible_duplicate: int = 0
    blocked: int = 0


class ImportReferenceSummary(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    candidates: list[ImportReferenceCandidate] = Field(default_factory=list)
    organization_counts: ImportReferenceCounts = Field(default_factory=ImportReferenceCounts)
    cost_centre_counts: ImportReferenceCounts = Field(default_factory=ImportReferenceCounts)


class ImportReferenceResult(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    created_count: int = 0
    reused_count: int = 0


class DuplicateWarning(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: str  # "existing_license" | "import_row"
    severity: str  # "high" | "medium"
    message: str
    matched_license_id: Optional[int] = None
    matched_license_ref: Optional[str] = None
    matched_row_number: Optional[int] = None
    match_fields: list[str]


class ImportWarningSummary(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    defaulted_currency_count: int = 0  # rows where currency was absent/blank (info only, does not gate)
    # Retained as zero-valued compatibility fields. Invalid enums and dates are
    # hard row errors and are not accepted warning categories.
    defaulted_enum_count: int = 0
    ambiguous_date_count: int = 0
    inferred_parent_count: int = 0  # maintenance rows whose parent was inferred from batch
    duplicate_warning_count: int = 0  # rows with at least one duplicate warning
    price_mismatch_count: int = 0  # rows whose Qty x Unit Price differs sharply from Total PO Price
    expired_maintenance_count: int = 0  # rows whose included maintenance coverage has ended
    legacy_unlinked_maintenance_count: int = 0  # explicitly selected parentless maintenance creates
    rows_with_warnings_count: int = 0  # non-error rows accepted with any non-fatal warning

    @computed_field  # type: ignore[misc]
    @property
    def has_warnings(self) -> bool:
        """True when high-signal warnings require acknowledgement."""
        return (
            self.inferred_parent_count > 0
            or self.duplicate_warning_count > 0
            or self.price_mismatch_count > 0
            or self.expired_maintenance_count > 0
            or self.legacy_unlinked_maintenance_count > 0
        )


class CSVImportPreviewRow(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    row_number: int
    publisher_name: str
    software_description: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notice_date: Optional[str] = None
    request_date: Optional[str] = None
    purchase_date: Optional[str] = None
    contract_number: str = ""
    po_number: str = ""
    procurement_reference: str = ""
    invoice_number: str = ""
    contact_email: str = ""
    supplier: str = ""
    cost_centre: str = ""
    license_type: str = ""
    license_metric: str = ""
    quantity: str = ""
    quantity_per_unit: str = ""
    effective_quantity: str = ""
    sku_code: str = ""
    unit_price: str = ""
    total_po_price: str = ""
    currency: str = "EUR"
    notes: Optional[str] = None
    budget_owner_email: str = ""
    secondary_contacts: list[str] = Field(default_factory=list)
    parent_license_ref: Optional[str] = None

    # Classification
    import_status: str  # "legacy_exempt" | "active" | "legacy_incomplete" | "error"
    validation_errors: list[str] = []
    warnings: list[str] = []
    duplicate_warnings: list[DuplicateWarning] = []
    import_action: str = "create"  # "create" | "update"
    matched_license_id: Optional[int] = None
    maintenance_parent_action: Optional[str] = None

    @field_validator("budget_owner_email", mode="before")
    @classmethod
    def _reject_budget_owner_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)


class CSVImportPreviewResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    rows: list[CSVImportPreviewRow]
    total_rows: int
    valid_rows: int  # rows with import_status != "error"
    legacy_exempt_count: int
    active_count: int
    legacy_incomplete_count: int
    error_count: int
    create_count: int = 0
    update_count: int = 0
    headers_found: list[str]  # internal field names detected in the file
    headers_missing: list[str]  # recommended fields absent from the file
    warning_summary: ImportWarningSummary = ImportWarningSummary()
    reference_summary: ImportReferenceSummary = Field(default_factory=ImportReferenceSummary)


class CSVImportError(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    row_number: int
    reason: str


class CSVImportConfirmResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    imported_count: int
    updated_count: int = 0
    skipped_count: int
    error_count: int
    errors: list[CSVImportError]
    warning_summary: ImportWarningSummary = ImportWarningSummary()
    warnings_acknowledged: bool = False
    reference_result: ImportReferenceResult = Field(default_factory=ImportReferenceResult)

# backend/app/services/import_/import_update.py
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.services.csv_importer import ParsedRow
from app.services.custom_fields_service import upsert_imported_values_for_license
from app.services.license_write_service import _resolve_contract_id

# ParsedRow attr -> License attr for plain string fields patched only when non-empty.
_STRING_PATCH_FIELDS: list[tuple[str, str]] = [
    ("publisher_name", "publisher_name"),
    ("software_description", "software_description"),
    ("po_number", "po_number"),
    ("invoice_number", "invoice_number"),
    ("contact_email", "contact_email"),
    ("supplier", "supplier"),
    ("cost_centre", "cost_centre"),
    ("budget_owner_email", "budget_owner_email"),
    ("quantity", "quantity"),
    ("sku_code", "sku_code"),
    ("unit_price", "unit_price"),
    ("total_po_price", "total_po_price"),
    ("currency", "currency"),
]


async def apply_import_update(
    license_obj: License,
    row: ParsedRow,
    custom_data: dict[str, str],
    db: AsyncSession,
    number_format_locale: str | None,
) -> None:
    """Patch an existing License from a parsed row.

    Only non-empty importable fields are written (blank cells preserve the
    existing value). license_type is immutable: a differing type raises
    ValueError. license_ref, chain/lifecycle/computed and maintenance-mirror
    fields, and maintenance parent linkage are never touched.
    """
    # license_type is immutable on update.
    if row.license_type and row.license_type != license_obj.license_type.value:
        raise ValueError(
            "license_type change is not supported via import "
            f"(record is {license_obj.license_type.value!r}, file says {row.license_type!r})"
        )

    for row_attr, col_attr in _STRING_PATCH_FIELDS:
        value = getattr(row, row_attr)
        if value:
            setattr(license_obj, col_attr, value)
            if col_attr == "invoice_number":
                license_obj.invoice_numbers = [value]

    # license_metric is a validated enum on the model.
    if row.license_metric:
        license_obj.license_metric = type(license_obj.license_metric)(row.license_metric)

    # Optional string fields that live as None when blank.
    if row.notes:
        license_obj.notes = row.notes
    if row.portal_url:
        license_obj.portal_url = row.portal_url
    if row.external_ref:
        license_obj.external_ref = row.external_ref

    # Contract number change -> re-resolve the linked contract_id.
    if row.contract_number:
        license_obj.contract_number = row.contract_number
        license_obj.contract_id = await _resolve_contract_id(db, row.contract_number)

    # Dates (typed). Perpetual records never carry an end_date.
    if row.db_start_date is not None:
        license_obj.start_date = row.db_start_date
    if row.db_end_date is not None and license_obj.license_type != LicenseType.perpetual:
        license_obj.end_date = row.db_end_date
    if row.db_notice_date is not None:
        license_obj.notice_date = row.db_notice_date
    if row.db_request_date is not None:
        license_obj.request_date = row.db_request_date
    if row.db_purchase_date is not None:
        license_obj.purchase_date = row.db_purchase_date

    if custom_data:
        await upsert_imported_values_for_license(db, license_obj.id, custom_data, number_format_locale)

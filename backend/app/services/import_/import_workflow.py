# backend/app/services/import_/import_workflow.py
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import UserSettings
from app.schemas.csv_import import (
    CSVImportError,
    CSVImportPreviewResponse,
    CSVImportPreviewRow,
    ImportWarningSummary,
)
from app.services.csv_importer import ParsedImportResult, ParsedRow
from app.services.custom_fields_service import upsert_imported_values_for_license
from app.services.import_.duplicate_detection import add_duplicate_warnings
from app.services.import_.license_builder import build_license
from app.services.import_.maintenance_parenting import infer_batch_maintenance_parents
from app.services.license_service import generate_license_ref
from app.models.license import License, LicenseType
from app.services.lifecycle_rules import mark_predecessor_renewed
from app.services.maintenance_service import sync_parent_mirror_fields

log = logging.getLogger(__name__)


async def get_import_defaults(db: AsyncSession, user_id: int) -> tuple[str, str, str]:
    """Return the user's currency, number locale, and date format for CSV import."""
    result = await db.execute(
        sa_select(UserSettings).where(UserSettings.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        return "EUR", "en-US", "DD/MM/YYYY"
    return (
        settings.display_currency or "EUR",
        settings.number_format_locale or "en-US",
        settings.date_format or "DD/MM/YYYY",
    )


async def prepare_import_rows(rows: list[ParsedRow], db: AsyncSession) -> None:
    """Run maintenance parent inference then duplicate detection in place."""
    infer_batch_maintenance_parents(rows)
    await add_duplicate_warnings(rows, db)


def build_warning_summary(rows: list[ParsedRow]) -> ImportWarningSummary:
    """Compute per-category warning counts across all parsed rows.

    Only non-error rows are counted for rows_with_warnings_count.
    Gating counts (defaulted_enum, ambiguous_date, inferred_parent,
    duplicate_warning) drive has_warnings (computed automatically).
    """
    defaulted_currency = 0
    defaulted_enum = 0
    ambiguous_date = 0
    inferred_parent = 0
    duplicate_warning = 0
    rows_with_warnings = 0

    for row in rows:
        if row.import_status == "error":
            continue

        row_has_any_warning = False

        if row.currency_defaulted:
            defaulted_currency += 1
            row_has_any_warning = True

        has_enum_warning = False
        has_date_warning = False

        for w in row.warnings:
            if "Unrecognised license_type" in w or "Unrecognised license_metric" in w:
                has_enum_warning = True
                row_has_any_warning = True
            elif "Unrecognised date format" in w or "treated as perpetual" in w:
                has_date_warning = True
                row_has_any_warning = True
            elif w:
                row_has_any_warning = True

        if has_enum_warning:
            defaulted_enum += 1
        if has_date_warning:
            ambiguous_date += 1

        if row.parent_import_row_number is not None:
            inferred_parent += 1
            row_has_any_warning = True

        if row.duplicate_warnings:
            duplicate_warning += 1
            row_has_any_warning = True

        if row_has_any_warning:
            rows_with_warnings += 1

    return ImportWarningSummary(
        defaulted_currency_count=defaulted_currency,
        defaulted_enum_count=defaulted_enum,
        ambiguous_date_count=ambiguous_date,
        inferred_parent_count=inferred_parent,
        duplicate_warning_count=duplicate_warning,
        rows_with_warnings_count=rows_with_warnings,
    )


def _row_to_schema(row: ParsedRow) -> CSVImportPreviewRow:
    return CSVImportPreviewRow(
        row_number=row.row_number,
        publisher_name=row.publisher_name,
        software_description=row.software_description,
        start_date=row.start_date,
        end_date=row.end_date,
        contract_number=row.contract_number,
        po_number=row.po_number,
        invoice_number=row.invoice_number,
        contact_email=row.contact_email,
        supplier=row.supplier,
        cost_centre=row.cost_centre,
        license_type=row.license_type,
        license_metric=row.license_metric,
        quantity=row.quantity,
        sku_code=row.sku_code,
        unit_price=row.unit_price,
        total_po_price=row.total_po_price,
        currency=row.currency,
        notes=row.notes,
        budget_owner_email=row.budget_owner_email,
        parent_license_ref=row.parent_license_ref,
        import_status=row.import_status,
        validation_errors=row.validation_errors,
        warnings=row.warnings,
        duplicate_warnings=row.duplicate_warnings,
    )


def build_preview_response(result: ParsedImportResult) -> CSVImportPreviewResponse:
    """Build the HTTP preview response schema from a ParsedImportResult."""
    row_schemas = [_row_to_schema(r) for r in result.rows]
    legacy_exempt_count = sum(1 for r in result.rows if r.import_status == "legacy_exempt")
    active_count = sum(1 for r in result.rows if r.import_status == "active")
    legacy_incomplete_count = sum(1 for r in result.rows if r.import_status == "legacy_incomplete")
    error_count = sum(1 for r in result.rows if r.import_status == "error")
    warning_summary = build_warning_summary(result.rows)
    return CSVImportPreviewResponse(
        rows=row_schemas,
        total_rows=len(result.rows),
        valid_rows=len(result.rows) - error_count,
        legacy_exempt_count=legacy_exempt_count,
        active_count=active_count,
        legacy_incomplete_count=legacy_incomplete_count,
        error_count=error_count,
        headers_found=result.headers_found,
        headers_missing=result.headers_missing,
        warning_summary=warning_summary,
    )


async def run_import_rows(
    rows: list[ParsedRow],
    custom_rows: list[dict[str, str]],
    skipped_rows: set[int],
    user_id: int,
    db: AsyncSession,
    number_format_locale: str | None = None,
) -> tuple[int, int, list[CSVImportError], int]:
    """Persist importable rows and return (imported_count, skipped_count, errors, custom_field_failure_count).

    custom_rows must be a parallel list to rows. Pass a list of empty dicts
    (one per row) for the legacy flow where no custom field mapping exists.
    """
    imported_count = 0
    skipped_count = 0
    import_errors: list[CSVImportError] = []
    custom_field_failure_count = 0
    inserted_by_row_number: dict[int, int] = {}

    for parsed, custom_data in zip(rows, custom_rows):
        if parsed.row_number in skipped_rows:
            skipped_count += 1
            continue

        if parsed.import_status == "error":
            skipped_count += 1
            reason = "; ".join(parsed.validation_errors) if parsed.validation_errors else "Unknown error"
            import_errors.append(CSVImportError(row_number=parsed.row_number, reason=reason))
            continue

        try:
            parent_license_id: Optional[int] = (
                inserted_by_row_number.get(parsed.parent_import_row_number)
                if parsed.parent_import_row_number is not None
                else None
            )
            license_obj = await build_license(parsed, user_id, db, parent_license_id)
            db.add(license_obj)
            await db.flush()
            license_obj.license_ref = await generate_license_ref(db)
            # F3: wire renewal chain — mark predecessor as renewed with back-link
            if license_obj.predecessor_id is not None:
                predecessor = await db.get(License, license_obj.predecessor_id)
                if predecessor is not None:
                    mark_predecessor_renewed(predecessor, license_obj.id)
            if license_obj.license_type == LicenseType.maintenance and license_obj.parent_license_id is not None:
                parent = await db.get(License, license_obj.parent_license_id)
                if parent is not None:
                    parent.active_maintenance_id = license_obj.id
                    await sync_parent_mirror_fields(db, parent)
            inserted_by_row_number[parsed.row_number] = license_obj.id

            if custom_data:
                missing_custom_keys = await upsert_imported_values_for_license(
                    db, license_obj.id, custom_data, number_format_locale,
                )
                custom_field_failure_count += len(missing_custom_keys)
                for cf_key in missing_custom_keys:
                    log.warning(
                        "run_import_rows: custom field key %r not found, skipping", cf_key
                    )

            imported_count += 1

        except Exception as exc:
            log.error("import failed on row %s: %s", parsed.row_number, exc, exc_info=True)
            skipped_count += 1
            import_errors.append(CSVImportError(row_number=parsed.row_number, reason=str(exc)))

    return imported_count, skipped_count, import_errors, custom_field_failure_count

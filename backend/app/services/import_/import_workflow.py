# backend/app/services/import_/import_workflow.py
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import UserSettings
from app.schemas.csv_import import (
    CSVImportError,
    CSVImportPreviewResponse,
    CSVImportPreviewRow,
    ImportWarningSummary,
)
from app.services.csv_importer import (
    EXPIRED_MAINTENANCE_WARNING,
    PRICE_MISMATCH_WARNING_PREFIX,
    ParsedImportResult,
    ParsedRow,
)
from app.services.custom_fields_service import upsert_imported_values_for_license
from app.services.import_.duplicate_detection import add_duplicate_warnings
from app.services.import_.import_update import apply_import_update
from app.services.import_.license_builder import build_license
from app.services.import_.license_matcher import annotate_update_targets
from app.services.import_.maintenance_parenting import infer_batch_maintenance_parents
from app.services.import_.reference_resolution import (
    _ReferenceTracker,
    ImportReferenceConflict,
    resolve_import_row_references,
)
from app.services.license_service import generate_license_ref
from app.models.license import License, LicenseType
from app.services.lifecycle_rules import mark_predecessor_renewed
from app.services.maintenance_service import activate_maintenance_for_parent, validate_parent_license

log = logging.getLogger(__name__)


def _restore_import_status(row: ParsedRow) -> None:
    today = date.today()
    end_in_past = row.db_end_date is not None and row.db_end_date < today
    if end_in_past and (not row.publisher_name or not row.software_description):
        row.import_status = "legacy_incomplete"
        row.lifecycle_status = "legacy"
        row.is_completeness_exempt = False
    elif end_in_past:
        row.import_status = "legacy_exempt"
        row.lifecycle_status = "legacy"
        row.is_completeness_exempt = True
    else:
        row.import_status = "active"
        row.lifecycle_status = None
        row.is_completeness_exempt = False


async def get_import_defaults(db: AsyncSession, user_id: int) -> tuple[str, str, str]:
    """Return the user's currency, number locale, and date format for CSV import."""
    result = await db.execute(sa_select(UserSettings).where(UserSettings.user_id == user_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        return "EUR", "en-US", "DD/MM/YYYY"
    return (
        settings.display_currency or "EUR",
        settings.number_format_locale or "en-US",
        settings.date_format or "DD/MM/YYYY",
    )


async def apply_import_row_overrides(
    rows: list[ParsedRow],
    db: AsyncSession,
    row_parent_overrides: dict[int, int] | None = None,
) -> None:
    """Apply import-time row corrections before inference and duplicate checks."""
    if not row_parent_overrides:
        return

    rows_by_number = {row.row_number: row for row in rows}
    for row_number, parent_license_id in row_parent_overrides.items():
        row = rows_by_number.get(row_number)
        if row is None:
            continue
        if row.license_type != "maintenance":
            row.validation_errors.append("Parent license selection is only valid for maintenance rows.")
            row.import_status = "error"
            continue
        try:
            parent = await validate_parent_license(db, parent_license_id)
        except ValueError as exc:
            row.validation_errors.append(str(exc))
            row.import_status = "error"
            continue
        row.selected_parent_license_id = parent.id
        row.parent_license_ref = parent.license_ref
        row.parent_import_row_number = None
        if row.import_status == "error" and any("parent_license_ref" in error for error in row.validation_errors):
            row.validation_errors = [
                error for error in row.validation_errors if "parent_license_ref" not in error
            ]
            if not row.validation_errors:
                _restore_import_status(row)
        if "Maintenance parent selected during import." not in row.warnings:
            row.warnings.append("Maintenance parent selected during import.")


async def prepare_import_rows(
    rows: list[ParsedRow],
    db: AsyncSession,
    update_existing: bool = False,
    row_parent_overrides: dict[int, int] | None = None,
) -> None:
    """Run maintenance parent inference, update-target annotation, then duplicate detection."""
    await apply_import_row_overrides(rows, db, row_parent_overrides)
    infer_batch_maintenance_parents(rows)
    if update_existing:
        await annotate_update_targets(db, rows)
    await add_duplicate_warnings(rows, db)


def build_warning_summary(rows: list[ParsedRow]) -> ImportWarningSummary:
    """Compute per-category warning counts across all parsed rows.

    Only non-error rows are counted for rows_with_warnings_count.
    Inferred-parent, duplicate, price-mismatch, and expired-maintenance
    warnings drive has_warnings. The enum and date fields remain zero-valued
    response compatibility fields because invalid enums and dates are hard row
    errors.
    """
    defaulted_currency = 0
    defaulted_enum = 0
    ambiguous_date = 0
    inferred_parent = 0
    duplicate_warning = 0
    price_mismatch = 0
    expired_maintenance = 0
    rows_with_warnings = 0

    for row in rows:
        if row.import_status == "error":
            continue

        row_has_any_warning = False

        if row.currency_defaulted:
            defaulted_currency += 1
            row_has_any_warning = True

        for w in row.warnings:
            if w:
                row_has_any_warning = True
            if w.startswith(PRICE_MISMATCH_WARNING_PREFIX):
                price_mismatch += 1
            if w == EXPIRED_MAINTENANCE_WARNING:
                expired_maintenance += 1

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
        price_mismatch_count=price_mismatch,
        expired_maintenance_count=expired_maintenance,
        rows_with_warnings_count=rows_with_warnings,
    )


def _row_to_schema(row: ParsedRow) -> CSVImportPreviewRow:
    return CSVImportPreviewRow(
        row_number=row.row_number,
        publisher_name=row.publisher_name,
        software_description=row.software_description,
        start_date=row.start_date,
        end_date=row.end_date,
        notice_date=row.notice_date,
        request_date=row.db_request_date.isoformat() if row.db_request_date else None,
        purchase_date=row.db_purchase_date.isoformat() if row.db_purchase_date else None,
        contract_number=row.contract_number,
        po_number=row.po_number,
        procurement_reference=row.procurement_reference,
        invoice_number=row.invoice_number,
        contact_email=row.contact_email,
        supplier=row.supplier,
        cost_centre=row.cost_centre,
        license_type=row.license_type,
        license_metric=row.license_metric,
        quantity=row.quantity,
        quantity_per_unit=row.quantity_per_unit,
        effective_quantity=row.effective_quantity,
        sku_code=row.sku_code,
        unit_price=row.unit_price,
        total_po_price=row.total_po_price,
        currency=row.currency,
        notes=row.notes,
        budget_owner_email=row.budget_owner_email,
        secondary_contacts=row.secondary_contacts,
        parent_license_ref=row.parent_license_ref,
        import_status=row.import_status,
        validation_errors=row.validation_errors,
        warnings=row.warnings,
        duplicate_warnings=row.duplicate_warnings,
        import_action=row.import_action,
        matched_license_id=row.matched_license_id,
    )


def build_preview_response(result: ParsedImportResult, reference_summary=None) -> CSVImportPreviewResponse:
    """Build the HTTP preview response schema from a ParsedImportResult."""
    row_schemas = [_row_to_schema(r) for r in result.rows]
    legacy_exempt_count = sum(1 for r in result.rows if r.import_status == "legacy_exempt")
    active_count = sum(1 for r in result.rows if r.import_status == "active")
    legacy_incomplete_count = sum(1 for r in result.rows if r.import_status == "legacy_incomplete")
    error_count = sum(1 for r in result.rows if r.import_status == "error")
    create_count = sum(1 for r in result.rows if r.import_status != "error" and r.import_action == "create")
    update_count = sum(1 for r in result.rows if r.import_status != "error" and r.import_action == "update")
    warning_summary = build_warning_summary(result.rows)
    return CSVImportPreviewResponse(
        rows=row_schemas,
        total_rows=len(result.rows),
        valid_rows=len(result.rows) - error_count,
        legacy_exempt_count=legacy_exempt_count,
        active_count=active_count,
        legacy_incomplete_count=legacy_incomplete_count,
        error_count=error_count,
        create_count=create_count,
        update_count=update_count,
        headers_found=result.headers_found,
        headers_missing=result.headers_missing,
        warning_summary=warning_summary,
        reference_summary=reference_summary,
    )


async def run_import_rows(
    rows: list[ParsedRow],
    custom_rows: list[dict[str, str]],
    skipped_rows: set[int],
    user_id: int,
    db: AsyncSession,
    number_format_locale: str | None = None,
    date_format: str | None = None,
    update_existing: bool = False,
    reference_overrides: dict | None = None,
    include_reference_result: bool = False,
) -> tuple:
    """Persist importable rows.

    Returns the established five-value result tuple. When
    ``include_reference_result`` is true, appends the reference-resolution
    result as a sixth value for the CSV API workflow.

    custom_rows must be a parallel list to rows. Pass a list of empty dicts
    (one per row) for callers that do not provide custom field values.
    When update_existing is True, rows whose LT Ref resolves to an active
    chain head patch that record instead of inserting a new one.
    """
    if update_existing:
        await annotate_update_targets(db, rows)

    created_count = 0
    updated_count = 0
    skipped_count = 0
    import_errors: list[CSVImportError] = []
    custom_field_failure_count = 0
    inserted_by_row_number: dict[int, int] = {}
    reference_tracker = _ReferenceTracker()
    reference_overrides = reference_overrides or {}

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
            did_update = False
            persisted_license_id: Optional[int] = None
            missing_custom_keys: list[str] = []
            row_reference_tracker = _ReferenceTracker()

            # A database-level failure on one row must not invalidate the
            # outer batch transaction or discard earlier successful rows.
            async with db.begin_nested():
                if update_existing and parsed.import_action == "update" and parsed.matched_license_id is not None:
                    target = await db.get(License, parsed.matched_license_id)
                    if target is None:
                        # Target vanished between preview and execute -> fall back to create.
                        parsed.import_action = "create"
                        parsed.matched_license_id = None
                    else:
                        await resolve_import_row_references(
                            db,
                            parsed,
                            reference_overrides,
                            row_reference_tracker,
                            is_update=True,
                        )
                        await apply_import_update(target, parsed, custom_data, db, number_format_locale, date_format)
                        did_update = True
                        persisted_license_id = target.id

                if not did_update:
                    await resolve_import_row_references(db, parsed, reference_overrides, row_reference_tracker)
                    parent_license_id: Optional[int] = None
                    if parsed.selected_parent_license_id is not None:
                        parent_license_id = parsed.selected_parent_license_id
                    elif parsed.parent_import_row_number is not None:
                        parent_license_id = inserted_by_row_number.get(parsed.parent_import_row_number)
                    license_obj = await build_license(parsed, user_id, db, parent_license_id)
                    license_obj.publisher_id = parsed.resolved_publisher_id
                    license_obj.supplier_id = parsed.resolved_supplier_id
                    license_obj.cost_centre_id = parsed.resolved_cost_centre_id
                    db.add(license_obj)
                    await db.flush()
                    license_obj.license_ref = await generate_license_ref(db)
                    # F3: wire renewal chain - mark predecessor as renewed with back-link
                    if license_obj.predecessor_id is not None:
                        predecessor = await db.get(License, license_obj.predecessor_id)
                        if predecessor is not None:
                            mark_predecessor_renewed(predecessor, license_obj.id)
                    if license_obj.license_type == LicenseType.maintenance and license_obj.parent_license_id is not None:
                        parent = await db.get(License, license_obj.parent_license_id)
                        if parent is not None:
                            await activate_maintenance_for_parent(db, license_obj, parent)
                    persisted_license_id = license_obj.id

                    if custom_data:
                        missing_custom_keys = await upsert_imported_values_for_license(
                            db,
                            license_obj.id,
                            custom_data,
                            number_format_locale,
                            date_format,
                        )

            if persisted_license_id is not None:
                inserted_by_row_number[parsed.row_number] = persisted_license_id
            reference_tracker.created_ids.update(row_reference_tracker.created_ids)
            reference_tracker.reused_ids.update(row_reference_tracker.reused_ids)
            if did_update:
                updated_count += 1
            else:
                created_count += 1
                custom_field_failure_count += len(missing_custom_keys)
                for cf_key in missing_custom_keys:
                    log.warning("run_import_rows: custom field key %r not found, skipping", cf_key)

        except ImportReferenceConflict as exc:
            if include_reference_result:
                raise
            log.error("import failed on row %s: %s", parsed.row_number, exc, exc_info=True)
            skipped_count += 1
            import_errors.append(CSVImportError(row_number=parsed.row_number, reason=str(exc.detail)))
        except HTTPException as exc:
            log.error("import failed on row %s: %s", parsed.row_number, exc, exc_info=True)
            skipped_count += 1
            import_errors.append(CSVImportError(row_number=parsed.row_number, reason=str(exc.detail)))
        except Exception as exc:
            log.error("import failed on row %s: %s", parsed.row_number, exc, exc_info=True)
            skipped_count += 1
            import_errors.append(CSVImportError(row_number=parsed.row_number, reason=str(exc)))

    result = (created_count, updated_count, skipped_count, import_errors, custom_field_failure_count)
    if include_reference_result:
        return (*result, reference_tracker.result())
    return result

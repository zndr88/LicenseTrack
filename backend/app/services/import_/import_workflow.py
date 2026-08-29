# backend/app/services/import_/import_workflow.py
from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import UserSettings
from app.schemas.csv_import import (
    CSVImportConfirmResponse,
    CSVImportError,
    CSVImportPreviewResponse,
    CSVImportPreviewRow,
    ImportReferenceResult,
    ImportWarningSummary,
    ImportReferenceOverride,
)
from app.services.audit_service import format_audit_detail
from app.services.csv_importer import (
    EXPIRED_MAINTENANCE_WARNING,
    PRICE_MISMATCH_WARNING_PREFIX,
    ParsedImportResult,
    ParsedRow,
)
from app.services.custom_fields_service import (
    upsert_imported_values_for_license,
    validate_imported_custom_rows,
)
from app.services.import_.duplicate_detection import add_duplicate_warnings
from app.services.import_.import_update import apply_import_update
from app.services.import_.license_builder import build_license
from app.services.import_.license_matcher import annotate_update_targets
from app.services.import_.maintenance_parenting import infer_batch_maintenance_parents
from app.services.import_.reference_resolution import (
    _ReferenceTracker,
    ImportReferenceConflict,
    parse_reference_overrides,
    resolve_import_row_references,
    validate_reference_overrides,
)
from app.services.license_service import generate_license_ref
from app.models.license import License, LicenseType
from app.services.lifecycle_rules import mark_predecessor_renewed
from app.services.maintenance_service import activate_maintenance_for_parent, validate_parent_license

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ImportExecutionOptions:
    skipped_rows: set[int]
    row_parent_overrides: dict[int, dict[str, int | str]]
    reference_overrides: dict


@dataclass(frozen=True)
class ImportExecutionResult:
    response: CSVImportConfirmResponse
    audit_detail: str | None


@dataclass(frozen=True)
class ImportRowsResult:
    created_count: int
    updated_count: int
    skipped_count: int
    errors: list[CSVImportError]
    custom_field_failure_count: int
    reference_result: ImportReferenceResult


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


def parse_import_execution_options(
    skipped_rows_json: str | None,
    row_overrides_json: str | None,
    reference_overrides_json: str | None,
) -> ImportExecutionOptions:
    skipped_rows: set[int] = set()
    if skipped_rows_json:
        try:
            raw_skipped_rows = json.loads(skipped_rows_json)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="skipped_rows_json is not valid JSON",
            ) from exc
        if not isinstance(raw_skipped_rows, list) or not all(
            isinstance(row, int) for row in raw_skipped_rows
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="skipped_rows_json must be a JSON array of row numbers",
            )
        skipped_rows = set(raw_skipped_rows)

    row_parent_overrides: dict[int, dict[str, int | str]] = {}
    if row_overrides_json:
        try:
            raw_row_overrides = json.loads(row_overrides_json)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json is not valid JSON",
            ) from exc
        if not isinstance(raw_row_overrides, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json must be a JSON array",
            )
        for item in raw_row_overrides:
            if not isinstance(item, dict):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="row_overrides_json entries must be objects",
                )
            allowed_keys = {
                "rowNumber",
                "row_number",
                "action",
                "parentLicenseId",
                "parent_license_id",
            }
            if set(item) - allowed_keys:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="row_overrides_json entries contain unknown fields",
                )
            row_number = item.get("rowNumber", item.get("row_number"))
            action = item.get("action")
            parent_license_id = item.get(
                "parentLicenseId",
                item.get("parent_license_id"),
            )
            if isinstance(row_number, bool) or not isinstance(row_number, int) or row_number <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="row_overrides_json entries require a positive integer rowNumber",
                )
            if action is None and parent_license_id is not None:
                action = "link_existing"
            if action not in {"link_existing", "import_legacy_unlinked"}:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="row_overrides_json entries require a supported action",
                )
            if row_number in row_parent_overrides:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"row_overrides_json contains duplicate rowNumber {row_number}",
                )
            if action == "link_existing":
                if (
                    isinstance(parent_license_id, bool)
                    or not isinstance(parent_license_id, int)
                    or parent_license_id <= 0
                ):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="link_existing requires a positive integer parentLicenseId",
                    )
                row_parent_overrides[row_number] = {
                    "action": action,
                    "parent_license_id": parent_license_id,
                }
            else:
                if parent_license_id is not None:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="import_legacy_unlinked must not include parentLicenseId",
                    )
                row_parent_overrides[row_number] = {"action": action}

    reference_overrides: dict = {}
    if reference_overrides_json:
        try:
            raw_reference_overrides = json.loads(reference_overrides_json)
            if not isinstance(raw_reference_overrides, list):
                raise ValueError
            reference_overrides = parse_reference_overrides(
                [
                    ImportReferenceOverride.model_validate(item)
                    for item in raw_reference_overrides
                ]
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "reference_overrides_json is not valid JSON or does not match expected schema"
                ),
            ) from exc

    return ImportExecutionOptions(
        skipped_rows=skipped_rows,
        row_parent_overrides=row_parent_overrides,
        reference_overrides=reference_overrides,
    )


async def apply_import_row_overrides(
    rows: list[ParsedRow],
    db: AsyncSession,
    row_parent_overrides: dict[int, dict[str, int | str] | int] | None = None,
) -> None:
    """Apply import-time row corrections before inference and duplicate checks."""
    if not row_parent_overrides:
        return

    rows_by_number = {row.row_number: row for row in rows}
    unknown_row_numbers = sorted(set(row_parent_overrides) - set(rows_by_number))
    if unknown_row_numbers:
        raise HTTPException(
            status_code=422,
            detail=(
                "row_overrides_json contains rowNumber values not present in the CSV: "
                f"{unknown_row_numbers}"
            ),
        )
    for row_number, override in row_parent_overrides.items():
        row = rows_by_number.get(row_number)
        if row.license_type != "maintenance":
            row.validation_errors.append("Parent license selection is only valid for maintenance rows.")
            row.import_status = "error"
            continue
        if isinstance(override, int) and not isinstance(override, bool):
            override = {"action": "link_existing", "parent_license_id": override}
        action = str(override["action"])
        row.maintenance_parent_action = action
        row.selected_parent_license_id = None
        row.parent_import_row_number = None
        if action == "import_legacy_unlinked":
            row.parent_license_ref = None
            row.validation_errors = [
                error for error in row.validation_errors
                if "parent_license_ref" not in error and "maintenance parent" not in error.lower()
            ]
            if not row.validation_errors:
                _restore_import_status(row)
            if "Legacy unlinked maintenance selected during import." not in row.warnings:
                row.warnings.append("Legacy unlinked maintenance selected during import.")
            continue
        parent_license_id = int(override["parent_license_id"])
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
    row_parent_overrides: dict[int, dict[str, int | str] | int] | None = None,
) -> None:
    """Run maintenance parent inference, update-target annotation, then duplicate detection."""
    await apply_import_row_overrides(rows, db, row_parent_overrides)
    infer_batch_maintenance_parents(rows)
    if update_existing:
        await annotate_update_targets(db, rows)
    await add_duplicate_warnings(rows, db)


def expand_skipped_inferred_rows(rows: list[ParsedRow], skipped_rows: set[int]) -> set[int]:
    """Cascade explicit skips to maintenance rows inferred from those rows.

    An inferred maintenance parent is a same-file dependency. If the parent
    is skipped, allowing its child through to the persistence loop would make
    the child appear importable in the UI and fail only when its generated
    foreign key is missing. Keep the existing skip semantics (count rows as
    skipped without manufacturing a validation error), while making the
    dependency decision deterministic before any writes occur.
    """
    effective_skips = set(skipped_rows)
    changed = True
    while changed:
        changed = False
        for row in rows:
            if (
                row.parent_import_row_number in effective_skips
                and row.row_number not in effective_skips
            ):
                effective_skips.add(row.row_number)
                changed = True
    return effective_skips


def build_warning_summary(rows: list[ParsedRow], skipped_rows: set[int] | None = None) -> ImportWarningSummary:
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
    legacy_unlinked_maintenance = 0
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

        if (
            row.maintenance_parent_action == "import_legacy_unlinked"
            and row.import_action == "create"
            and (not skipped_rows or row.row_number not in skipped_rows)
        ):
            legacy_unlinked_maintenance += 1
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
        legacy_unlinked_maintenance_count=legacy_unlinked_maintenance,
        rows_with_warnings_count=rows_with_warnings,
    )


def _row_to_schema(row: ParsedRow) -> CSVImportPreviewRow:
    return CSVImportPreviewRow.model_validate(
        {
            **vars(row),
            "request_date": row.db_request_date.isoformat() if row.db_request_date else None,
            "purchase_date": row.db_purchase_date.isoformat() if row.db_purchase_date else None,
            "inferred_parent_row_number": row.parent_import_row_number,
        }
    )


def build_preview_response(result: ParsedImportResult, reference_summary=None) -> CSVImportPreviewResponse:
    """Build the HTTP preview response schema from a ParsedImportResult."""
    row_schemas = [_row_to_schema(r) for r in result.rows]
    status_counts = Counter(row.import_status for row in result.rows)
    legacy_exempt_count = status_counts["legacy_exempt"]
    active_count = status_counts["active"]
    legacy_incomplete_count = status_counts["legacy_incomplete"]
    error_count = status_counts["error"]
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
    raise_reference_conflicts: bool = False,
) -> ImportRowsResult:
    """Persist importable rows.

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
    skipped_rows = expand_skipped_inferred_rows(rows, skipped_rows)

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
                    if parsed.maintenance_parent_action == "import_legacy_unlinked":
                        parent_license_id = None
                    elif parsed.selected_parent_license_id is not None:
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
            if raise_reference_conflicts:
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

    return ImportRowsResult(
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        errors=import_errors,
        custom_field_failure_count=custom_field_failure_count,
        reference_result=reference_tracker.result(),
    )


async def execute_import_workflow(
    rows: list[ParsedRow],
    custom_rows: list[dict[str, str]],
    *,
    options: ImportExecutionOptions,
    acknowledge_warnings: bool,
    update_existing: bool,
    user_id: int,
    db: AsyncSession,
    number_format_locale: str,
    date_format: str,
    import_mode: str,
) -> ImportExecutionResult:
    """Validate and persist one native or mapped CSV import transaction."""
    await validate_imported_custom_rows(
        db,
        rows,
        custom_rows,
        number_format_locale,
        date_format,
    )
    await prepare_import_rows(
        rows,
        db,
        update_existing=update_existing,
        row_parent_overrides=options.row_parent_overrides,
    )
    skipped_rows = expand_skipped_inferred_rows(rows, options.skipped_rows)
    await validate_reference_overrides(
        db,
        rows,
        skipped_rows,
        options.reference_overrides,
    )

    warning_summary = build_warning_summary(rows, skipped_rows)
    if warning_summary.has_warnings and not acknowledge_warnings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "warnings_require_acknowledgement",
                "message": (
                    "Import has warnings that require acknowledgement. "
                    "Resubmit with acknowledgeWarnings=true."
                ),
                "warningSummary": warning_summary.model_dump(by_alias=True),
            },
        )

    rows_result = await run_import_rows(
        rows,
        custom_rows,
        skipped_rows,
        user_id,
        db,
        number_format_locale,
        date_format,
        update_existing=update_existing,
        reference_overrides=options.reference_overrides,
        raise_reference_conflicts=True,
    )
    imported_count = rows_result.created_count
    updated_count = rows_result.updated_count
    skipped_count = rows_result.skipped_count
    import_errors = rows_result.errors
    custom_field_failures = rows_result.custom_field_failure_count
    reference_result = rows_result.reference_result
    audit_detail = None
    if imported_count > 0 or updated_count > 0:
        audit_detail = format_audit_detail(
            "csv_import",
            {
                "importMode": import_mode,
                "insertedCount": str(imported_count),
                "updatedCount": str(updated_count),
                "skippedCount": str(skipped_count),
                "errorCount": str(len(import_errors)),
                "defaultedEnumCount": str(warning_summary.defaulted_enum_count),
                "ambiguousDateCount": str(warning_summary.ambiguous_date_count),
                "inferredParentCount": str(warning_summary.inferred_parent_count),
                "duplicateWarningCount": str(warning_summary.duplicate_warning_count),
                "priceMismatchCount": str(warning_summary.price_mismatch_count),
                "expiredMaintenanceCount": str(warning_summary.expired_maintenance_count),
                "legacyUnlinkedMaintenanceCount": str(
                    warning_summary.legacy_unlinked_maintenance_count
                ),
                "customFieldFailureCount": str(custom_field_failures),
                "acknowledgedWarnings": str(acknowledge_warnings).lower(),
                "referenceCreatedCount": str(reference_result.created_count),
                "referenceReusedCount": str(reference_result.reused_count),
            },
        )
    return ImportExecutionResult(
        response=CSVImportConfirmResponse(
            imported_count=imported_count,
            updated_count=updated_count,
            skipped_count=skipped_count,
            error_count=len(import_errors),
            errors=import_errors,
            warning_summary=warning_summary,
            warnings_acknowledged=acknowledge_warnings,
            reference_result=reference_result,
        ),
        audit_detail=audit_detail,
    )

# backend/app/services/import_/license_matcher.py
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.services.csv_importer import ParsedRow


async def annotate_update_targets(db: AsyncSession, rows: list[ParsedRow]) -> None:
    """Annotate each importable row with its create/update action in place.

    MATCH  -> import_action="update", matched_license_id set.
    AMBIGUOUS -> import_status="error" with a validation error (skipped later).
    Error rows and rows without an LT Ref are left as "create".
    """
    importable_rows = [row for row in rows if row.import_status != "error"]
    refs = {(row.license_ref or "").strip() for row in importable_rows}
    refs.discard("")
    heads_by_ref: dict[str, list[License]] = {}
    if refs:
        result = await db.execute(
            select(License).where(
                License.license_ref.in_(refs),
                License.is_retired.is_(False),
                License.renewed_to_id.is_(None),
            )
        )
        for license_obj in result.scalars().all():
            heads_by_ref.setdefault(license_obj.license_ref, []).append(license_obj)

    for row in importable_rows:
        row.import_action = "create"
        row.matched_license_id = None
        ref = (row.license_ref or "").strip()
        heads = heads_by_ref.get(ref, [])
        if len(heads) == 1:
            row.import_action = "update"
            row.matched_license_id = heads[0].id
        elif len(heads) > 1:
            row.validation_errors.append(
                f"LT Ref {row.license_ref!r} is ambiguous: it matches multiple "
                f"active licenses. Resolve the duplicate refs before importing."
            )
            row.import_status = "error"

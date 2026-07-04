# backend/app/services/import_/license_matcher.py
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.services.csv_importer import ParsedRow


class ResolveOutcome(Enum):
    MATCH = "match"
    NO_MATCH = "no_match"
    AMBIGUOUS = "ambiguous"


@dataclass
class ResolveResult:
    outcome: ResolveOutcome
    license_id: Optional[int] = None


async def resolve_update_target(db: AsyncSession, row: ParsedRow) -> ResolveResult:
    """Resolve a row's LT Ref to the license it should update.

    Match target = the current chain head sharing the ref: is_retired = false
    AND renewed_to_id IS NULL. Exactly one -> MATCH; none -> NO_MATCH (create);
    two or more active heads -> AMBIGUOUS (skip with error).
    """
    ref = (row.license_ref or "").strip()
    if not ref:
        return ResolveResult(ResolveOutcome.NO_MATCH)

    result = await db.execute(
        sa_select(License).where(
            License.license_ref == ref,
            License.is_retired.is_(False),
            License.renewed_to_id.is_(None),
        )
    )
    heads = result.scalars().all()
    if len(heads) == 1:
        return ResolveResult(ResolveOutcome.MATCH, heads[0].id)
    if len(heads) == 0:
        return ResolveResult(ResolveOutcome.NO_MATCH)
    return ResolveResult(ResolveOutcome.AMBIGUOUS)


async def annotate_update_targets(db: AsyncSession, rows: list[ParsedRow]) -> None:
    """Annotate each importable row with its create/update action in place.

    MATCH  -> import_action="update", matched_license_id set.
    AMBIGUOUS -> import_status="error" with a validation error (skipped later).
    Error rows and rows without an LT Ref are left as "create".
    """
    for row in rows:
        if row.import_status == "error":
            continue
        result = await resolve_update_target(db, row)
        if result.outcome == ResolveOutcome.MATCH:
            row.import_action = "update"
            row.matched_license_id = result.license_id
        elif result.outcome == ResolveOutcome.AMBIGUOUS:
            row.validation_errors.append(
                f"LT Ref {row.license_ref!r} is ambiguous: it matches multiple "
                f"active licenses. Resolve the duplicate refs before importing."
            )
            row.import_status = "error"

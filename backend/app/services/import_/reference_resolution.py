from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.reference_data import CostCentre, CostCentreAlias, Organization, OrganizationAlias
from app.schemas.csv_import import (
    ImportReferenceCandidate,
    ImportReferenceCounts,
    ImportReferenceMatch,
    ImportReferenceOverride,
    ImportReferenceResult,
    ImportReferenceSummary,
)
from app.services.csv_importer import ParsedRow
from app.services.reference_data_service import (
    clean_reference_name,
    normalize_reference_name,
    resolve_cost_centre,
    resolve_organization,
)

_MAX_SAMPLE_ROWS = 5
_SIMILARITY_THRESHOLD = 0.82


class ImportReferenceConflict(HTTPException):
    """A batch-level reference decision conflict that must abort API execution."""


@dataclass
class _Candidate:
    kind: str
    candidate_key: str
    proposed_name: str
    role_usage: set[str] = field(default_factory=set)
    spellings: list[str] = field(default_factory=list)
    row_numbers: list[int] = field(default_factory=list)


@dataclass
class _ReferenceTracker:
    created_ids: set[tuple[str, int]] = field(default_factory=set)
    reused_ids: set[tuple[str, int]] = field(default_factory=set)

    def result(self) -> ImportReferenceResult:
        return ImportReferenceResult(
            created_count=len(self.created_ids),
            reused_count=len(self.reused_ids - self.created_ids),
        )


def _candidate_key(kind: str, value: str) -> str:
    return f"{kind}:{normalize_reference_name(value)}"


def _row_reference_values(row: ParsedRow):
    if row.publisher_name:
        yield "organization", row.publisher_name, "publisher"
    elif row.import_action != "update":
        yield "organization", "Unknown", "publisher"
    if row.supplier:
        yield "organization", row.supplier, "supplier"
    if row.cost_centre:
        yield "cost_centre", row.cost_centre, None


def _row_can_be_reference_candidate(row: ParsedRow) -> bool:
    if row.import_status != "error":
        return True
    if row.license_type != "maintenance" or not row.validation_errors:
        return False
    return all(
        "parent_license_ref" in error or "maintenance parent" in error.lower()
        for error in row.validation_errors
    )


def _add_candidate(
    candidates: dict[str, _Candidate],
    *,
    kind: str,
    value: str,
    row_number: int,
    role: str | None = None,
) -> None:
    cleaned = clean_reference_name(value)
    key = _candidate_key(kind, cleaned)
    candidate = candidates.setdefault(key, _Candidate(kind, key, cleaned))
    if role:
        candidate.role_usage.add(role)
    if cleaned not in candidate.spellings:
        candidate.spellings.append(cleaned)
    if row_number not in candidate.row_numbers and len(candidate.row_numbers) < _MAX_SAMPLE_ROWS:
        candidate.row_numbers.append(row_number)


async def _reference_records(db: AsyncSession, kind: str):
    if kind == "organization":
        result = await db.execute(
            select(Organization).options(selectinload(Organization.aliases)).order_by(Organization.name)
        )
        return list(result.scalars().all())
    result = await db.execute(
        select(CostCentre).options(selectinload(CostCentre.aliases)).order_by(CostCentre.name)
    )
    return list(result.scalars().all())


def _match_record(records, normalized: str):
    for record in records:
        if record.normalized_name == normalized:
            return record
        if any(alias.normalized_name == normalized for alias in record.aliases):
            return record
    return None


def _similarity_score(left: str, right: str) -> float:
    score = SequenceMatcher(None, left, right).ratio()
    left_words = set(left.split())
    right_words = set(right.split())
    shorter = left_words if len(left_words) <= len(right_words) else right_words
    longer = right_words if shorter is left_words else left_words
    if shorter and shorter < longer and len(" ".join(shorter)) >= 5:
        score = max(score, 0.86)
    return score


def _record_similarity_score(record, normalized: str) -> float:
    names = [record.normalized_name, *(alias.normalized_name for alias in record.aliases)]
    return max(_similarity_score(normalized, name) for name in names)


def _possible_matches(records, normalized: str) -> list:
    matches = []
    for record in records:
        score = _record_similarity_score(record, normalized)
        if score >= _SIMILARITY_THRESHOLD:
            matches.append((score, record))
    return [record for _, record in sorted(matches, key=lambda pair: (-pair[0], pair[1].name))[:3]]


def _match_schema(record) -> ImportReferenceMatch:
    return ImportReferenceMatch(id=record.id, name=record.name, is_active=record.is_active)


def _candidate_match_schema(candidate: _Candidate) -> ImportReferenceMatch:
    return ImportReferenceMatch(
        candidate_key=candidate.candidate_key,
        name=candidate.proposed_name,
        is_active=True,
    )


async def build_reference_summary(db: AsyncSession, rows: list[ParsedRow]) -> ImportReferenceSummary:
    candidates: dict[str, _Candidate] = {}
    for row in rows:
        if not _row_can_be_reference_candidate(row):
            continue
        for kind, value, role in _row_reference_values(row):
            _add_candidate(candidates, kind=kind, value=value, row_number=row.row_number, role=role)

    organization_records = await _reference_records(db, "organization")
    cost_centre_records = await _reference_records(db, "cost_centre")
    counts = {"organization": ImportReferenceCounts(), "cost_centre": ImportReferenceCounts()}
    summaries = []
    for candidate in sorted(candidates.values(), key=lambda value: (value.kind, value.proposed_name.casefold())):
        records = organization_records if candidate.kind == "organization" else cost_centre_records
        normalized = normalize_reference_name(candidate.proposed_name)
        matched = _match_record(records, normalized)
        possible = _possible_matches(records, normalized) if matched is None or not matched.is_active else []
        if matched is not None:
            possible = [record for record in possible if record.id != matched.id]
        batch_possible = [
            other
            for other in candidates.values()
            if other.kind == candidate.kind
            and other.candidate_key != candidate.candidate_key
            and _similarity_score(normalized, normalize_reference_name(other.proposed_name)) >= _SIMILARITY_THRESHOLD
        ]
        batch_possible.sort(key=lambda value: (value.proposed_name.casefold(), value.candidate_key))
        if matched is not None:
            candidate_status = "matched" if matched.is_active else "inactive_conflict"
            matched_schema = _match_schema(matched)
        elif possible or batch_possible:
            candidate_status = "possible_duplicate"
            matched_schema = None
        else:
            candidate_status = "new"
            matched_schema = None
        count = counts[candidate.kind]
        if candidate_status == "matched":
            count.matched += 1
        elif candidate_status == "new":
            count.new += 1
        elif candidate_status == "possible_duplicate":
            count.possible_duplicate += 1
        else:
            count.blocked += 1
        summaries.append(
            ImportReferenceCandidate(
                kind=candidate.kind,
                role_usage=sorted(candidate.role_usage),
                candidate_key=candidate.candidate_key,
                proposed_name=candidate.proposed_name,
                source_spellings=candidate.spellings,
                occurrence_count=sum(
                    1
                    for row in rows
                    if _row_can_be_reference_candidate(row)
                    for value_kind, value, _role in _row_reference_values(row)
                    if _candidate_key(value_kind, value) == candidate.candidate_key
                ),
                sample_row_numbers=candidate.row_numbers,
                status=candidate_status,
                matched=matched_schema,
                possible_matches=[
                    *[_match_schema(record) for record in possible],
                    *[_candidate_match_schema(other) for other in batch_possible],
                ][:3],
            )
        )
    return ImportReferenceSummary(
        candidates=summaries,
        organization_counts=counts["organization"],
        cost_centre_counts=counts["cost_centre"],
    )


def _override_for(
    overrides: dict[str, ImportReferenceOverride],
    kind: str,
    value: str,
) -> ImportReferenceOverride | None:
    return overrides.get(_candidate_key(kind, value))


def _conflict(message: str) -> HTTPException:
    return ImportReferenceConflict(status_code=status.HTTP_409_CONFLICT, detail=message)


async def _resolve_organization_value(
    db: AsyncSession,
    value: str,
    roles: set[str],
    override: ImportReferenceOverride | None,
    tracker: _ReferenceTracker,
) -> tuple[str, int]:
    cleaned = clean_reference_name(value)
    if override and override.action == "map_existing":
        if override.target_id is None:
            raise _conflict("A mapped organization override requires targetId.")
        record = await db.get(Organization, override.target_id)
        if record is None:
            raise _conflict("The selected organization was deleted or merged after preview.")
        if not override.target_name or record.name != clean_reference_name(override.target_name):
            raise _conflict("The selected organization changed after preview; preview the import again.")
        if not record.is_active:
            raise _conflict(f"Organization '{record.name}' is inactive and requires admin action.")
        for role in roles:
            if role == "publisher":
                record.is_publisher = True
            if role == "supplier":
                record.is_supplier = True
        tracker.reused_ids.add(("organization", record.id))
        return record.name, record.id

    value_to_resolve = (
        override.display_name
        if override and override.action == "accept_new" and override.display_name
        else cleaned
    )
    if override and override.action == "keep_separate":
        value_to_resolve = override.display_name or cleaned
    normalized = normalize_reference_name(value_to_resolve)
    before = await db.scalar(select(Organization).where(Organization.normalized_name == normalized))
    if before is None:
        alias = await db.scalar(select(OrganizationAlias).where(OrganizationAlias.normalized_name == normalized))
        before = await db.get(Organization, alias.organization_id) if alias else None
    if before is not None and not before.is_active:
        raise _conflict(f"Organization '{before.name}' is inactive and requires admin action.")
    if before is None and not override:
        possible = await _reference_records(db, "organization")
        if _possible_matches(possible, normalize_reference_name(value_to_resolve)):
            raise _conflict(f"Organization '{cleaned}' has possible duplicates and requires an import decision.")
    role = "publisher" if "publisher" in roles else "supplier"
    record = await resolve_organization(db, value_to_resolve, role=role, create_if_missing=True)
    for role in roles:
        if role == "publisher":
            record.is_publisher = True
        if role == "supplier":
            record.is_supplier = True
    if before is None:
        tracker.created_ids.add(("organization", record.id))
    else:
        tracker.reused_ids.add(("organization", record.id))
    return record.name, record.id


async def _resolve_cost_centre_value(
    db: AsyncSession,
    value: str,
    override: ImportReferenceOverride | None,
    tracker: _ReferenceTracker,
) -> tuple[str, int]:
    cleaned = clean_reference_name(value)
    if override and override.action == "map_existing":
        if override.target_id is None:
            raise _conflict("A mapped cost-centre override requires targetId.")
        record = await db.get(CostCentre, override.target_id)
        if record is None:
            raise _conflict("The selected cost centre was deleted or merged after preview.")
        if not override.target_name or record.name != clean_reference_name(override.target_name):
            raise _conflict("The selected cost centre changed after preview; preview the import again.")
        if not record.is_active:
            raise _conflict(f"Cost centre '{record.name}' is inactive and requires admin action.")
        tracker.reused_ids.add(("cost_centre", record.id))
        return record.name, record.id
    value_to_resolve = (
        override.display_name
        if override and override.action == "accept_new" and override.display_name
        else cleaned
    )
    if override and override.action == "keep_separate":
        value_to_resolve = override.display_name or cleaned
    normalized = normalize_reference_name(value_to_resolve)
    before = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
    if before is None:
        alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
        before = await db.get(CostCentre, alias.cost_centre_id) if alias else None
    if before is not None and not before.is_active:
        raise _conflict(f"Cost centre '{before.name}' is inactive and requires admin action.")
    if before is None and not override:
        possible = await _reference_records(db, "cost_centre")
        if _possible_matches(possible, normalized):
            raise _conflict(f"Cost centre '{cleaned}' has possible duplicates and requires an import decision.")
    record = await resolve_cost_centre(db, value_to_resolve, create_if_missing=True)
    if before is None:
        tracker.created_ids.add(("cost_centre", record.id))
    else:
        tracker.reused_ids.add(("cost_centre", record.id))
    return record.name, record.id


async def _resolve_import_row_references(
    db: AsyncSession,
    row: ParsedRow,
    overrides: dict[str, ImportReferenceOverride],
    tracker: _ReferenceTracker,
    *,
    is_update: bool = False,
) -> None:
    if row.publisher_name or not is_update:
        publisher_value = row.publisher_name or "Unknown"
        publisher_name, publisher_id = await _resolve_organization_value(
            db,
            publisher_value,
            {"publisher"},
            _override_for(overrides, "organization", publisher_value),
            tracker,
        )
        row.publisher_name = publisher_name
        row.resolved_publisher_id = publisher_id
    else:
        row.resolved_publisher_id = None
    if row.supplier:
        supplier_name, supplier_id = await _resolve_organization_value(
            db, row.supplier, {"supplier"}, _override_for(overrides, "organization", row.supplier), tracker
        )
        row.supplier = supplier_name
        row.resolved_supplier_id = supplier_id
    else:
        row.resolved_supplier_id = None
    if row.cost_centre:
        cost_centre_name, cost_centre_id = await _resolve_cost_centre_value(
            db, row.cost_centre, _override_for(overrides, "cost_centre", row.cost_centre), tracker
        )
        row.cost_centre = cost_centre_name
        row.resolved_cost_centre_id = cost_centre_id
    else:
        row.resolved_cost_centre_id = None


async def resolve_import_row_references(
    db: AsyncSession,
    row: ParsedRow,
    overrides: dict[str, ImportReferenceOverride],
    tracker: _ReferenceTracker,
    *,
    is_update: bool = False,
) -> None:
    try:
        await _resolve_import_row_references(
            db,
            row,
            overrides,
            tracker,
            is_update=is_update,
        )
    except ImportReferenceConflict:
        raise
    except HTTPException as exc:
        raise ImportReferenceConflict(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from exc


def parse_reference_overrides(items: list[ImportReferenceOverride]) -> dict[str, ImportReferenceOverride]:
    overrides = {}
    for item in items:
        if item.candidate_key in overrides:
            raise HTTPException(status_code=422, detail=f"Duplicate reference override for {item.candidate_key!r}.")
        overrides[item.candidate_key] = item
    return overrides


async def validate_reference_overrides(
    db: AsyncSession,
    rows: list[ParsedRow],
    skipped_rows: set[int],
    overrides: dict[str, ImportReferenceOverride],
) -> ImportReferenceSummary:
    """Rebuild and validate the reference plan before any import row is written."""
    active_rows = [
        row
        for row in rows
        if row.import_status != "error" and row.row_number not in skipped_rows
    ]
    summary = await build_reference_summary(db, active_rows)
    missing = []
    records_by_kind = {
        "organization": await _reference_records(db, "organization"),
        "cost_centre": await _reference_records(db, "cost_centre"),
    }
    planned_new_names: dict[tuple[str, str], str] = {}

    for candidate in summary.candidates:
        override = overrides.get(candidate.candidate_key)
        if candidate.status in {"possible_duplicate", "inactive_conflict"} and override is None:
            missing.append(candidate.proposed_name)
            continue
        if override is None:
            continue
        if candidate.status == "matched":
            raise _conflict(
                f"Reference data for '{candidate.proposed_name}' changed after preview; preview the import again."
            )
        if candidate.status == "inactive_conflict" and override.action != "map_existing":
            raise _conflict(
                f"Inactive reference '{candidate.proposed_name}' must be mapped to an active reference."
            )

        records = records_by_kind[candidate.kind]
        if override.action == "map_existing":
            if override.target_id is None or not override.target_name or not override.target_name.strip():
                raise _conflict("Mapped reference decisions require a target ID and previewed target name.")
            model = Organization if candidate.kind == "organization" else CostCentre
            target = await db.get(model, override.target_id)
            if target is None:
                raise _conflict("The selected reference was deleted or merged after preview.")
            if target.name != clean_reference_name(override.target_name):
                raise _conflict("The selected reference was renamed after preview; preview the import again.")
            if not target.is_active:
                raise _conflict(f"Reference '{target.name}' is inactive and requires admin action.")
            continue

        if not override.display_name or not override.display_name.strip():
            raise _conflict("New reference decisions require a canonical display name.")
        display_name = clean_reference_name(override.display_name)
        normalized_display = normalize_reference_name(display_name)
        planned_key = (candidate.kind, normalized_display)
        other_candidate = planned_new_names.get(planned_key)
        if other_candidate and other_candidate != candidate.candidate_key:
            raise _conflict(
                f"Canonical display name '{display_name}' was selected for multiple candidates."
            )
        planned_new_names[planned_key] = candidate.candidate_key
        existing = _match_record(records, normalized_display)
        if existing is not None:
            raise _conflict(
                f"Reference name '{display_name}' now belongs to an existing record; preview the import again."
            )

    if missing:
        names = ", ".join(missing[:5])
        suffix = "" if len(missing) <= 5 else f" and {len(missing) - 5} more"
        raise _conflict(f"Reference-data decisions are required for {names}{suffix}.")

    # Decisions for candidates whose rows were all skipped are intentionally ignored.
    return summary

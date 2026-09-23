"""Materialize planned sourcing-line renewal links at PO conversion."""

from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.models.sourcing import SourcingItem
from app.services.license_service import is_renewable_license
from app.services.lifecycle_rules import (
    assert_predecessor_has_no_successor,
    assert_successor_term,
    mark_predecessor_renewed,
    normalize_entitlement_identity,
)


# Types that never take part in a planned renewal chain; Service/Other follow
# their renewable opt-in through is_renewable_license.
_NEVER_PLANNED_SUCCESSOR_TYPES = frozenset({LicenseType.freeware, LicenseType.perpetual, LicenseType.maintenance})


async def apply_planned_successor_links(
    db: AsyncSession,
    items: list[SourcingItem],
) -> tuple[set[int], list[int]]:
    """Apply every planned edge after all PO lines exist as license records."""
    incoming: dict[int, list[int]] = defaultdict(list)
    item_by_id = {item.id: item for item in items}
    for item in items:
        target_id = item.successor_sourcing_item_id
        if target_id is None:
            continue
        if target_id not in item_by_id:
            raise HTTPException(status_code=409, detail=f"Line {item.id} has a successor outside this PO")
        incoming[target_id].append(item.id)
    if not incoming:
        return set(), []

    linked_item_ids = set(incoming).union(*incoming.values())
    result = await db.execute(select(License).where(License.source_sourcing_item_id.in_(linked_item_ids)))
    licenses_by_item_id = {lic.source_sourcing_item_id: lic for lic in result.scalars().all()}
    if set(licenses_by_item_id) != linked_item_ids:
        raise HTTPException(status_code=409, detail="Every linked PO line must create one license")

    remaining = set(incoming)
    renewed_successor_ids: set[int] = set()
    predecessor_ids: list[int] = []
    while remaining:
        ready = sorted(
            target_id for target_id in remaining
            if not any(source_id in remaining for source_id in incoming[target_id])
        )
        if not ready:
            raise HTTPException(status_code=409, detail="Planned successor links contain a cycle")
        for target_id in ready:
            successor = licenses_by_item_id[target_id]
            predecessors = [licenses_by_item_id[source_id] for source_id in incoming[target_id]]
            predecessors.sort(key=lambda lic: (lic.start_date is None, lic.start_date, lic.id))
            if successor.renewed_from_id is not None or successor.predecessor_id is not None:
                raise HTTPException(status_code=409, detail=f"Line {target_id} already has a predecessor")
            if not is_renewable_license(successor) or successor.license_type in _NEVER_PLANNED_SUCCESSOR_TYPES:
                raise HTTPException(status_code=422, detail=f"Line {target_id} cannot be a renewal successor")
            publisher = normalize_entitlement_identity(successor.publisher_name)
            if not publisher:
                raise HTTPException(status_code=422, detail=f"Line {target_id} needs a publisher")
            for predecessor in predecessors:
                assert_predecessor_has_no_successor(predecessor)
                if normalize_entitlement_identity(predecessor.publisher_name) != publisher:
                    raise HTTPException(status_code=422, detail=f"Line {target_id} must match predecessor publisher")
                if not is_renewable_license(predecessor) or predecessor.license_type in _NEVER_PLANNED_SUCCESSOR_TYPES:
                    raise HTTPException(status_code=422, detail=f"Line {target_id} follows a nonrenewable license")
            assert_successor_term(predecessors, successor.start_date, successor.end_date)
            primary = predecessors[0]
            successor.renewed_from_id = primary.id
            successor.predecessor_id = primary.id
            if len(predecessors) > 1:
                successor.coterm_from_ids = [lic.id for lic in predecessors]
            successor.license_ref = primary.license_ref
            for predecessor in predecessors:
                mark_predecessor_renewed(predecessor, successor.id)
                predecessor_ids.append(predecessor.id)
            renewed_successor_ids.add(successor.id)
            remaining.remove(target_id)
    await db.flush()
    return renewed_successor_ids, predecessor_ids

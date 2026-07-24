from datetime import date

import pytest
from fastapi import HTTPException

from app.models.license import License, LicenseMetric, LicenseType
from app.services.lifecycle_rules import (
    validate_lifecycle_repair_update,
    validate_renewal_link_invariants,
)


def _license(label: str) -> License:
    return License(
        publisher_name="Acme",
        software_description=label,
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        currency="EUR",
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
    )


async def _persist(db_session, *licenses: License) -> None:
    db_session.add_all(licenses)
    await db_session.flush()


def test_intermediate_license_may_have_incoming_and_outgoing_links():
    intermediate = _license("B")
    intermediate.id = 2
    intermediate.renewed_from_id = 1
    intermediate.predecessor_id = 1
    intermediate.renewed_to_id = 3

    validate_renewal_link_invariants(intermediate)


async def test_repair_accepts_existing_reciprocal_three_generation_chain(db_session):
    first = _license("A")
    intermediate = _license("B")
    successor = _license("C")
    await _persist(db_session, first, intermediate, successor)

    first.renewed_to_id = intermediate.id
    intermediate.renewed_from_id = first.id
    intermediate.predecessor_id = first.id
    intermediate.renewed_to_id = successor.id
    successor.renewed_from_id = intermediate.id
    successor.predecessor_id = intermediate.id
    await db_session.flush()

    await validate_lifecycle_repair_update(
        db_session,
        intermediate,
        {"lifecycle_status": "renewed"},
    )


async def test_repair_accepts_secondary_coterm_predecessor(db_session):
    primary = _license("A")
    secondary = _license("B")
    successor = _license("C")
    await _persist(db_session, primary, secondary, successor)

    primary.renewed_to_id = successor.id
    secondary.renewed_to_id = successor.id
    successor.renewed_from_id = primary.id
    successor.predecessor_id = primary.id
    successor.coterm_from_ids = [primary.id, secondary.id]
    await db_session.flush()

    await validate_lifecycle_repair_update(
        db_session,
        secondary,
        {"renewed_to_id": successor.id},
    )


async def test_repair_rejects_repointing_existing_successor(db_session):
    predecessor = _license("A")
    existing_successor = _license("C")
    conflicting_successor = _license("D")
    await _persist(db_session, predecessor, existing_successor, conflicting_successor)

    predecessor.renewed_to_id = existing_successor.id
    existing_successor.renewed_from_id = predecessor.id
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await validate_lifecycle_repair_update(
            db_session,
            predecessor,
            {"renewed_to_id": conflicting_successor.id},
        )

    assert exc_info.value.status_code == 400
    assert "already been renewed" in exc_info.value.detail


async def test_repair_rejects_three_node_cycle(db_session):
    first = _license("A")
    second = _license("B")
    third = _license("C")
    await _persist(db_session, first, second, third)

    first.renewed_to_id = second.id
    second.renewed_from_id = first.id
    second.renewed_to_id = third.id
    third.renewed_from_id = second.id
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await validate_lifecycle_repair_update(
            db_session,
            third,
            {"renewed_to_id": first.id},
        )

    assert exc_info.value.status_code == 400
    assert "cycle" in exc_info.value.detail


@pytest.mark.parametrize(
    ("invalid_target", "expected_status", "expected_detail"),
    [
        ("self", 400, "itself"),
        ("missing", 404, "not found"),
        ("duplicate_coterm", 400, "duplicate"),
    ],
)
async def test_repair_rejects_invalid_targets(
    db_session,
    invalid_target,
    expected_status,
    expected_detail,
):
    license_obj = _license("A")
    other = _license("B")
    await _persist(db_session, license_obj, other)
    update_data_by_target = {
        "self": {"renewed_to_id": license_obj.id},
        "missing": {"renewed_to_id": 999999},
        "duplicate_coterm": {"coterm_from_ids": [other.id, other.id]},
    }

    with pytest.raises(HTTPException) as exc_info:
        await validate_lifecycle_repair_update(
            db_session,
            license_obj,
            update_data_by_target[invalid_target],
        )

    assert exc_info.value.status_code == expected_status
    assert expected_detail in exc_info.value.detail

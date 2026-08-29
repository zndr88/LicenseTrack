from datetime import date

import pytest
from fastapi import HTTPException

from app.models.license import License, LicenseMetric, LicenseType
from app.services.lifecycle_rules import (
    assert_can_initiate_renewal,
    assert_successor_term,
    clear_pending_renewal,
    entitlement_identity,
    validate_lifecycle_repair_update,
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


def test_clear_pending_renewal_preserves_existing_coterm_ancestry():
    successor = _license("Coterm successor")
    successor.lifecycle_status = "pending_renewal"
    successor.renewed_from_id = 1
    successor.predecessor_id = 1
    successor.coterm_from_ids = [1, 2]

    clear_pending_renewal(successor)

    assert successor.lifecycle_status is None
    assert successor.renewed_from_id == 1
    assert successor.predecessor_id == 1
    assert successor.coterm_from_ids == [1, 2]


@pytest.mark.parametrize("license_type", [LicenseType.service, LicenseType.other])
def test_initiate_renewal_rejects_non_renewable_types(license_type):
    license_obj = _license("Non-renewable")
    license_obj.license_type = license_type

    with pytest.raises(HTTPException) as exc_info:
        assert_can_initiate_renewal(license_obj)

    assert exc_info.value.status_code == 400
    assert "service or other" in exc_info.value.detail


def test_initiate_renewal_requires_budget_owner():
    license_obj = _license("Unowned renewal")
    license_obj.budget_owner_email = " "

    with pytest.raises(HTTPException) as exc_info:
        assert_can_initiate_renewal(license_obj)

    assert exc_info.value.status_code == 400
    assert "budget owner" in exc_info.value.detail.lower()


def test_successor_term_must_advance_start_and_end_dates():
    predecessor = _license("Predecessor")

    with pytest.raises(HTTPException, match="start after"):
        assert_successor_term(
            [predecessor],
            successor_start=predecessor.start_date,
            successor_end=date(2026, 12, 31),
        )

    with pytest.raises(HTTPException, match="extend coverage"):
        assert_successor_term(
            [predecessor],
            successor_start=date(2026, 1, 1),
            successor_end=predecessor.end_date,
        )


def test_entitlement_identity_includes_sku_metric_and_license_type():
    first = _license("Acme Suite")
    first.sku_code = " SKU-ONE "
    second = _license("  acme   suite ")
    second.sku_code = "sku-two"

    assert entitlement_identity(first) != entitlement_identity(second)


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

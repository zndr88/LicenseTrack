from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.license import (
    License,
    LicenseMaintenanceLink,
    LicenseMetric,
    LicenseType,
    MaintenanceCoverage,
)
from app.models.sourcing import SourcingItem
from app.services import renewal_orchestrator
from app.services.renewal_orchestrator import create_renewal_successor_from_sourcing_item


def _license_data(**overrides) -> dict:
    data = {
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "1",
        "currency": "EUR",
        "start_date": date(2026, 1, 1),
        "end_date": date(2026, 12, 31),
    }
    data.update(overrides)
    return data


def _renewal_data(**overrides) -> dict:
    data = _license_data(
        license_type=LicenseType.subscription,
        maintenance_coverage=MaintenanceCoverage.separately_tracked,
    )
    data.update(overrides)
    return data


async def test_single_renewal_rejects_invalid_coverage_before_lifecycle_mutation(db_session):
    predecessor = License(**_license_data())
    db_session.add(predecessor)
    await db_session.flush()
    sourcing_item = SourcingItem(
        publisher_name="Acme",
        software_description="Acme Suite renewal",
        renewal_for_license_id=predecessor.id,
    )
    db_session.add(sourcing_item)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await create_renewal_successor_from_sourcing_item(
            db=db_session,
            sourcing_item=sourcing_item,
            license_data=_renewal_data(),
            created_by=None,
            missing_license_detail="predecessor missing",
        )

    assert exc.value.status_code == 400
    assert "Use included coverage" in exc.value.detail
    assert predecessor.renewed_to_id is None
    assert (
        await db_session.execute(select(License).where(License.renewed_from_id == predecessor.id))
    ).scalars().all() == []


async def test_coterm_legacy_maintenance_rejects_invalid_coverage_atomically(db_session):
    parent = License(**_license_data(license_type=LicenseType.perpetual, end_date=None))
    db_session.add(parent)
    await db_session.flush()
    secondary = License(
        **_license_data(
            license_type=LicenseType.maintenance,
            parent_license_id=parent.id,
            end_date=date(2027, 12, 31),
        )
    )
    legacy = License(
        **_license_data(
            license_type=LicenseType.maintenance,
            parent_license_id=None,
            is_legacy_unlinked_maintenance=True,
            end_date=date(2027, 12, 31),
        )
    )
    db_session.add_all([secondary, legacy])
    await db_session.flush()
    sourcing_item = SourcingItem(
        publisher_name="Acme",
        software_description="Coterm maintenance renewal",
        renewal_for_license_id=legacy.id,
        coterm_predecessor_ids=[legacy.id, secondary.id],
    )
    db_session.add(sourcing_item)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await create_renewal_successor_from_sourcing_item(
            db=db_session,
            sourcing_item=sourcing_item,
            license_data=_renewal_data(license_type=LicenseType.maintenance),
            created_by=None,
            missing_license_detail="predecessor missing",
        )

    assert exc.value.status_code == 400
    assert legacy.renewed_to_id is None
    assert secondary.renewed_to_id is None
    assert (
        await db_session.execute(select(License).where(License.renewed_from_id.in_([legacy.id, secondary.id])))
    ).scalars().all() == []


async def test_existing_successor_reservation_rejects_second_predecessor(db_session):
    predecessor_a = License(
        **_license_data(
            start_date=date(2025, 1, 1),
            end_date=date(2026, 9, 20),
        )
    )
    predecessor_b = License(
        **_license_data(
            start_date=date(2025, 1, 1),
            end_date=date(2026, 9, 20),
        )
    )
    successor = License(
        **_license_data(
            start_date=date(2026, 9, 21),
            end_date=date(2027, 9, 20),
            coterm_from_ids=None,
        )
    )
    db_session.add_all([predecessor_a, predecessor_b, successor])
    await db_session.flush()

    await renewal_orchestrator._reserve_existing_successor_link(
        db_session,
        predecessor_a,
        successor,
    )

    with pytest.raises(HTTPException, match="already has a predecessor"):
        await renewal_orchestrator._reserve_existing_successor_link(
            db_session,
            predecessor_b,
            successor,
        )

    assert successor.renewed_from_id == predecessor_a.id
    assert successor.predecessor_id == predecessor_a.id
    assert predecessor_b.lifecycle_status is None


async def test_shared_maintenance_successor_activates_compatibility_parent_first(
    db_session,
    monkeypatch,
):
    secondary_parent = License(
        **_license_data(license_type=LicenseType.perpetual, end_date=None)
    )
    compatibility_parent = License(
        **_license_data(license_type=LicenseType.perpetual, end_date=None)
    )
    db_session.add_all([secondary_parent, compatibility_parent])
    await db_session.flush()
    predecessor = License(
        **_license_data(
            license_type=LicenseType.maintenance,
            parent_license_id=compatibility_parent.id,
        )
    )
    db_session.add(predecessor)
    await db_session.flush()
    db_session.add_all([
        LicenseMaintenanceLink(
            maintenance_license_id=predecessor.id,
            parent_license_id=secondary_parent.id,
        ),
        LicenseMaintenanceLink(
            maintenance_license_id=predecessor.id,
            parent_license_id=compatibility_parent.id,
        ),
    ])
    await db_session.flush()
    successor = License(
        **_license_data(license_type=LicenseType.maintenance)
    )
    activated_parent_ids = []

    async def record_activation(_db, _successor, parent):
        activated_parent_ids.append(parent.id)

    monkeypatch.setattr(
        renewal_orchestrator,
        "link_or_activate_maintenance",
        record_activation,
    )

    await renewal_orchestrator._activate_maintenance_successor_for_all_parents(
        db_session,
        predecessor,
        successor,
    )

    assert activated_parent_ids == [compatibility_parent.id, secondary_parent.id]


async def test_existing_maintenance_link_undo_preserves_original_successor_parent(db_session):
    from app.services.maintenance_service import activate_maintenance_for_parent
    parents = [License(**_license_data(license_type=LicenseType.perpetual, end_date=None)) for _ in range(2)]
    db_session.add_all(parents)
    await db_session.flush()
    predecessor = License(**_license_data(license_type=LicenseType.maintenance, parent_license_id=parents[0].id))
    successor = License(**_license_data(license_type=LicenseType.maintenance, parent_license_id=parents[0].id))
    db_session.add_all([predecessor, successor])
    await db_session.flush()
    for parent in parents:
        await activate_maintenance_for_parent(db_session, predecessor, parent)
    await activate_maintenance_for_parent(db_session, successor, parents[0])
    await renewal_orchestrator._snapshot_existing_maintenance_link(db_session, predecessor, successor)
    await renewal_orchestrator._activate_maintenance_successor_for_all_parents(db_session, predecessor, successor)
    await renewal_orchestrator._finish_existing_maintenance_snapshot(db_session, predecessor)
    await db_session.commit()
    await renewal_orchestrator._restore_existing_maintenance_link(db_session, predecessor, successor)
    await db_session.flush()
    assert parents[0].active_maintenance_id == successor.id
    assert parents[1].active_maintenance_id == predecessor.id
    assert set((await db_session.scalars(select(LicenseMaintenanceLink.parent_license_id).where(
        LicenseMaintenanceLink.maintenance_license_id == successor.id,
    ))).all()) == {parents[0].id}

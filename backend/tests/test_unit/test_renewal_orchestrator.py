from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.license import License, LicenseMetric, LicenseType, MaintenanceCoverage
from app.models.sourcing import SourcingItem
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

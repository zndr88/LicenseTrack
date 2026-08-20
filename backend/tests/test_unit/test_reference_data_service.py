import pytest
from fastapi import HTTPException

from app.models.reference_data import OrganizationAlias
from app.services.reference_data_service import (
    clean_reference_name,
    normalize_reference_name,
    resolve_cost_centre,
    resolve_organization,
)


def test_reference_names_use_nfkc_whitespace_and_casefold():
    assert clean_reference_name("  Ｍicrosoft\t  Corporation ") == "Microsoft Corporation"
    assert normalize_reference_name("  Ｍicrosoft\t  Corporation ") == "microsoft corporation"


@pytest.mark.asyncio
async def test_organization_alias_resolution_promotes_roles(db_session):
    organization = await resolve_organization(
        db_session, "Microsoft", role="publisher", create_if_missing=True
    )
    db_session.add(
        OrganizationAlias(
            organization_id=organization.id,
            name="MSFT",
            normalized_name=normalize_reference_name("MSFT"),
        )
    )
    await db_session.flush()

    resolved = await resolve_organization(
        db_session, " msft ", role="supplier", create_if_missing=True
    )

    assert resolved.id == organization.id
    assert resolved.name == "Microsoft"
    assert resolved.is_publisher is True
    assert resolved.is_supplier is True


@pytest.mark.asyncio
async def test_inactive_canonical_and_alias_resolution_is_conflict(db_session):
    organization = await resolve_organization(
        db_session, "Legacy Vendor", role="supplier", create_if_missing=True
    )
    organization.is_active = False
    db_session.add(
        OrganizationAlias(
            organization_id=organization.id,
            name="Old Vendor",
            normalized_name=normalize_reference_name("Old Vendor"),
        )
    )
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await resolve_organization(
            db_session, "Old Vendor", role="supplier", create_if_missing=True
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_cost_centre_alias_resolution_returns_canonical_record(db_session):
    cost_centre = await resolve_cost_centre(db_session, "Finance", create_if_missing=True)
    from app.models.reference_data import CostCentreAlias

    db_session.add(
        CostCentreAlias(
            cost_centre_id=cost_centre.id,
            name="FIN",
            normalized_name=normalize_reference_name("FIN"),
        )
    )
    await db_session.flush()

    resolved = await resolve_cost_centre(db_session, "fin", create_if_missing=True)
    assert resolved.id == cost_centre.id
    assert resolved.name == "Finance"

"""Contract-number identity helpers."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.contract import Contract
from app.models.license import License


def normalize_contract_number(contract_number: str | None) -> str:
    """Return the canonical comparison value for a contract number."""
    return (contract_number or "").strip().lower()


def contract_number_is_unambiguous(contract: Contract | type[Contract]):
    """Return a SQL condition requiring one unique, non-blank contract number."""
    other_contract = aliased(Contract)
    normalized_number = func.lower(func.trim(contract.contract_number))
    duplicate_exists = exists(
        select(other_contract.id).where(
            other_contract.id != contract.id,
            func.lower(func.trim(other_contract.contract_number)) == normalized_number,
        )
    )
    return and_(normalized_number != "", ~duplicate_exists)


def license_contract_match(contract: Contract):
    """Match explicit links, with an unambiguous null-only legacy fallback."""
    return or_(
        License.contract_id == contract.id,
        and_(
            License.contract_id.is_(None),
            func.lower(func.trim(License.contract_number)) == normalize_contract_number(contract.contract_number),
            contract_number_is_unambiguous(contract),
        ),
    )


async def find_contracts_by_number(
    db: AsyncSession,
    contract_number: str | None,
    *,
    exclude_contract_id: int | None = None,
) -> list[Contract]:
    normalized = normalize_contract_number(contract_number)
    if not normalized:
        return []

    query = select(Contract).where(func.lower(func.trim(Contract.contract_number)) == normalized)
    if exclude_contract_id is not None:
        query = query.where(Contract.id != exclude_contract_id)
    result = await db.execute(query.order_by(Contract.id.asc()))
    return list(result.scalars().all())


async def assert_unique_contract_number(
    db: AsyncSession,
    contract_number: str | None,
    *,
    exclude_contract_id: int | None = None,
) -> None:
    if await find_contracts_by_number(db, contract_number, exclude_contract_id=exclude_contract_id):
        raise HTTPException(status_code=409, detail="A contract with this contract number already exists.")


async def assert_contract_number_unambiguous(
    db: AsyncSession,
    contract_number: str | None,
    *,
    current_contract_id: int,
) -> None:
    if await find_contracts_by_number(db, contract_number, exclude_contract_id=current_contract_id):
        raise HTTPException(
            status_code=409,
            detail="Contract number is duplicated by another contract record. Resolve duplicates before renaming.",
        )


async def resolve_contract_id_for_number(db: AsyncSession, contract_number: str | None) -> int | None:
    """Resolve a contract id for license linking, or fail on ambiguous records."""
    contracts = await find_contracts_by_number(db, contract_number)
    if not contracts:
        return None
    if len(contracts) > 1:
        raise HTTPException(
            status_code=409,
            detail="Contract number matches multiple contract records. Resolve duplicate contracts before linking licenses.",
        )
    return contracts[0].id

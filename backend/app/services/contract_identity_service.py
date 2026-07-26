"""Contract-number identity helpers."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract


def normalize_contract_number(contract_number: str | None) -> str:
    """Return the canonical comparison value for a contract number."""
    return (contract_number or "").strip().lower()


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

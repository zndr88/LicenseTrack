"""
Response assembly for contracts.

Provides build_contract_response(), which enriches a Contract ORM object
with computed license_count, document_count, and per-folder document counts.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract, ContractDocument
from app.models.license import License
from app.schemas.contract import ContractFolderResponse, ContractResponse
from app.services.access_service import apply_department_filter


async def build_contract_response(
    contract: Contract,
    db: AsyncSession,
    departments: list[str] | None = None,
) -> ContractResponse:
    """Compute license_count, document_count, folder doc counts and build ContractResponse."""
    license_count_query = select(func.count(License.id)).where(
        func.lower(License.contract_number) == func.lower(contract.contract_number)
    )
    license_count_query = apply_department_filter(license_count_query, departments)
    lic_count_result = await db.execute(license_count_query)
    license_count = lic_count_result.scalar_one() or 0

    doc_count_result = await db.execute(
        select(func.count(ContractDocument.id)).where(ContractDocument.contract_id == contract.id)
    )
    document_count = doc_count_result.scalar_one() or 0

    # Batch per-folder doc counts in one query instead of N+1 round-trips.
    folder_ids = [folder.id for folder in contract.folders]
    if folder_ids:
        counts_result = await db.execute(
            select(ContractDocument.folder_id, func.count(ContractDocument.id))
            .where(ContractDocument.folder_id.in_(folder_ids))
            .group_by(ContractDocument.folder_id)
        )
        folder_doc_counts: dict[int, int] = dict(counts_result.all())
    else:
        folder_doc_counts = {}

    folder_responses: list[ContractFolderResponse] = [
        ContractFolderResponse(
            id=folder.id,
            name=folder.name,
            created_at=folder.created_at,
            document_count=folder_doc_counts.get(folder.id, 0),
        )
        for folder in contract.folders
    ]

    return ContractResponse(
        id=contract.id,
        contract_number=contract.contract_number,
        publisher_name=contract.publisher_name,
        notes=contract.notes,
        created_at=contract.created_at,
        created_by=contract.created_by,
        license_count=license_count,
        document_count=document_count,
        folders=folder_responses,
    )

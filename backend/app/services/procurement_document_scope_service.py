"""Resolve the licenses covered by a procurement-document scope."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import ProcurementDocument
from app.models.license import License


async def get_procurement_document_licenses(
    db: AsyncSession,
    document: ProcurementDocument,
) -> list[License]:
    """Return licenses covered by the document's one explicit ownership scope."""
    if document.license_id is not None:
        query = select(License).where(License.id == document.license_id)
    elif document.pending_order_id is not None:
        query = select(License).where(License.pending_order_id == document.pending_order_id)
    elif document.procurement_bundle_id is not None:
        query = select(License).where(License.procurement_bundle_id == document.procurement_bundle_id)
    else:
        return []

    result = await db.execute(query)
    return list(result.scalars().all())

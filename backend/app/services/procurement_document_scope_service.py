"""Resolve the licenses covered by a procurement-document scope."""

from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import ProcurementDocument
from app.models.license import License


async def filter_viewable_procurement_documents(db: AsyncSession, documents: list[ProcurementDocument], user):
    """Filter a document collection with one related-license query."""
    from app.services.access_service import get_user_departments_for_scope

    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return documents
    license_ids = {doc.license_id for doc in documents if doc.license_id is not None}
    order_ids = {doc.pending_order_id for doc in documents if doc.pending_order_id is not None}
    bundle_ids = {doc.procurement_bundle_id for doc in documents if doc.procurement_bundle_id is not None}
    predicates = []
    if license_ids:
        predicates.append(License.id.in_(license_ids))
    if order_ids:
        predicates.append(License.pending_order_id.in_(order_ids))
    if bundle_ids:
        predicates.append(License.procurement_bundle_id.in_(bundle_ids))
    if not predicates:
        return []
    related_result = await db.execute(select(License).where(or_(*predicates)))
    grouped: dict[tuple[str, int], list[License]] = defaultdict(list)
    for license_obj in related_result.scalars().all():
        if license_obj.id in license_ids:
            grouped[("license", license_obj.id)].append(license_obj)
        if license_obj.pending_order_id in order_ids:
            grouped[("order", license_obj.pending_order_id)].append(license_obj)
        if license_obj.procurement_bundle_id in bundle_ids:
            grouped[("bundle", license_obj.procurement_bundle_id)].append(license_obj)

    def in_scope(doc: ProcurementDocument) -> bool:
        if doc.license_id is not None:
            related = grouped[("license", doc.license_id)]
        elif doc.pending_order_id is not None:
            related = grouped[("order", doc.pending_order_id)]
        elif doc.procurement_bundle_id is not None:
            related = grouped[("bundle", doc.procurement_bundle_id)]
        else:
            related = []
        return bool(related) and all(
            license_obj.cost_centre_id is not None and license_obj.cost_centre_id in departments
            for license_obj in related
        )

    return [doc for doc in documents if in_scope(doc)]


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

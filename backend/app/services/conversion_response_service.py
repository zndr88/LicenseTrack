from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License
from app.schemas.license import LicenseResponse
from app.services.license_response_service import enrich_license_response, get_procurement_documents_by_scope
from app.services.settings_service import get_global_settings as _get_cached_global_settings


async def build_conversion_response(
    db: AsyncSession,
    new_license_entries: list[tuple[int, str]],
    predecessor_ids: list[int],
) -> list[LicenseResponse]:
    new_license_type_map = {lid: ctype for lid, ctype in new_license_entries}
    all_return_ids = [lid for lid, _ in new_license_entries] + predecessor_ids

    reload_result = await db.execute(
        select(License)
        .where(License.id.in_(all_return_ids))
        .options(
            selectinload(License.documents),
            selectinload(License.creator),
            selectinload(License.maintenance_parent_links),
            selectinload(License.maintenance_child_links),
        )
    )
    licenses = list(reload_result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, licenses)

    gs = await _get_cached_global_settings(db)
    mandatory_fields = (gs.mandatory_fields if gs else {}) or {}
    notification_days = int(gs.notification_days) if gs else 30
    storage_base = (gs.storage_path if gs else "") or None

    responses: list[LicenseResponse] = []
    for lic in licenses:
        resp = enrich_license_response(
            lic,
            mandatory_fields,
            notification_days,
            procurement_documents=procurement_documents_by_license_id.get(lic.id, []),
            storage_base=storage_base,
        )
        resp.conversion_type = new_license_type_map.get(lic.id, "renewed_predecessor")
        responses.append(resp)

    return responses

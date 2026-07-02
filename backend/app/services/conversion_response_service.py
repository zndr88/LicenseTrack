from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License
from app.models.settings import GlobalSettings
from app.schemas.license import LicenseResponse
from app.services.license_service import (
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)


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
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    licenses = list(reload_result.scalars().all())

    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = gs_result.scalar_one_or_none()
    mandatory_fields = (gs.mandatory_fields if gs else {}) or {}

    today = date.today()
    responses: list[LicenseResponse] = []
    for lic in licenses:
        docs = list(lic.documents)
        resp = LicenseResponse.model_validate(lic)
        resp.completeness_pct = compute_completeness(lic, docs, mandatory_fields)
        resp.days_until_expiry = compute_days_until_expiry(lic, today)
        resp.expiration_status = compute_expiration_status(lic, today)
        resp.document_count = len(docs)
        resp.conversion_type = new_license_type_map.get(lic.id, "renewed_predecessor")
        responses.append(resp)

    return responses

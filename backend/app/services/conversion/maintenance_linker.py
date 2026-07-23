from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.services.maintenance_service import create_maintenance_for_parent, validate_parent_license


async def create_maintenance_purchase(
    *,
    db: AsyncSession,
    item_data: dict,
    created_by: int | None,
    created_parent_by_sourcing_item_id: dict[int, License],
    item_id: int,
) -> License:
    parent_sourcing_item_id = item_data.pop("parent_sourcing_item_id", None)
    parent_id = item_data.get("parent_license_id")

    if parent_id is not None and parent_sourcing_item_id is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id}: choose either parentLicenseId or parentSourcingItemId, not both",
        )
    if parent_id is not None:
        try:
            parent = await validate_parent_license(db, parent_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Item {item_id}: {exc}")
    elif parent_sourcing_item_id is not None:
        parent = created_parent_by_sourcing_item_id.get(parent_sourcing_item_id)
        if parent is None:
            result = await db.execute(
                select(License).where(
                    License.source_sourcing_item_id == parent_sourcing_item_id,
                    License.is_retired.is_(False),
                )
            )
            parent = result.scalars().first()
        if parent is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Item {item_id}: parentSourcingItemId {parent_sourcing_item_id} "
                    "does not refer to an active perpetual/OEM/freeware license"
                ),
            )
        try:
            parent = await validate_parent_license(db, parent.id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Item {item_id}: {exc}")
    else:
        raise HTTPException(
            status_code=400,
            detail=(f"Item {item_id}: maintenance licenses require parentLicenseId or parentSourcingItemId"),
        )

    return await create_maintenance_for_parent(
        db,
        parent,
        item_data,
        created_by=created_by,
    )

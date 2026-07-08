"""
CSV export helpers for sourcing items.
"""

from __future__ import annotations

import csv
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services.csv_safety import safe_csv_row


async def build_sourcing_export_csv(db: AsyncSession) -> str:
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.status == SourcingStatus.sourcing)
        .order_by(SourcingItem.created_at.desc())
    )
    items = list(result.scalars().all())

    renewal_license_ids = [
        item.renewal_for_license_id
        for item in items
        if item.renewal_for_license_id is not None
    ]
    predecessor_map: dict[int, License] = {}
    if renewal_license_ids:
        pred_result = await db.execute(
            select(License).where(License.id.in_(renewal_license_ids))
        )
        predecessor_map = {lic.id: lic for lic in pred_result.scalars().all()}

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "ID", "License Ref", "External Ref",
        "Publisher", "Software Description",
        "Purchase Quantity", "Est. Unit Price", "Est. Total Price",
        "Currency", "Supplier", "Contact Email",
        "Status", "Is Renewal", "Renewal For License ID",
        "Created At",
    ])

    for item in items:
        pred = predecessor_map.get(item.renewal_for_license_id) \
            if item.renewal_for_license_id else None
        writer.writerow(safe_csv_row([
            item.id,
            pred.license_ref if pred else "",
            pred.external_ref if pred else "",
            item.publisher_name,
            item.software_description,
            item.quantity or "",
            item.estimated_unit_price or "",
            item.estimated_total_price or "",
            item.currency or "",
            item.supplier or "",
            item.contact_email or "",
            item.status.value,
            "Yes" if item.renewal_for_license_id else "No",
            item.renewal_for_license_id or "",
            item.created_at.date().isoformat() if item.created_at else "",
        ]))

    return output.getvalue()

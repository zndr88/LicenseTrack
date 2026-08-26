"""Notifications endpoint - aggregated license alerts."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser
from app.models.license import License
from app.models.user import UserRole
from app.schemas.notification import NotificationItem
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.document_availability_service import available_documents
from app.services.license_response_service import get_procurement_documents_by_scope
from app.services.notification_classification import classify_license_alerts, sort_alerts
from app.services.settings_service import get_global_settings

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[NotificationItem])
async def get_notifications(db: DbSession, current_user: CurrentUser) -> list[NotificationItem]:
    """Return aggregated license alerts sorted by severity then date."""
    gs = await get_global_settings(db)
    mandatory_fields = gs.mandatory_fields if gs and gs.mandatory_fields else {}
    expiry_window_days = (
        gs.notification_days if gs and gs.notification_days and 1 <= gs.notification_days <= 365 else 90
    )
    notice_window_days = (
        gs.notice_notification_days
        if gs.notice_notification_days and 1 <= gs.notice_notification_days <= 365
        else 30
    ) if gs else 30

    query = select(License).where(License.is_retired.is_(False)).options(selectinload(License.documents))
    departments = None
    if current_user.role == UserRole.viewer:
        departments = await get_viewer_departments(current_user.id, db)
    result = await db.execute(apply_department_filter(query, departments))
    licenses = list(result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, licenses)

    alerts: list[dict] = []
    today = date.today()
    for license_obj in licenses:
        documents = available_documents(
            [
                *list(license_obj.documents),
                *procurement_documents_by_license_id.get(license_obj.id, []),
            ],
            (gs.storage_path if gs else "") or None,
        )
        alerts.extend(
            classify_license_alerts(
                license_obj,
                documents,
                mandatory_fields,
                expiry_window_days,
                notice_window_days,
                today=today,
            )
        )

    return [NotificationItem.model_validate(alert) for alert in sort_alerts(alerts)]

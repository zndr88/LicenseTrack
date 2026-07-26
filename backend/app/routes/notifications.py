"""
Notifications endpoint - aggregated license alerts.

GET /api/notifications returns four alert categories for all non-retired licenses:
  - expiring: end_date within 90 days, grouped into 30/60/90-day urgency bands
  - expired:  end_date in the past (and not renewed)
  - notice_due: notice_date within the configured notice deadline window
  - incomplete: completeness_pct below 80 %

Severity mapping
  critical  - expired, overdue notice dates, or alerts due within 7 days
  warning   - expiring or notice alerts due within 8-30 days
  info      - later configured-window alerts, or incomplete

Sort order: severity (critical first), then relevant_date ascending (None last).
"""

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
from app.services.license_service import compute_completeness
from app.services.license_response_service import get_procurement_documents_by_scope
from app.services.settings_service import get_global_settings

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_INCOMPLETE_THRESHOLD = 80

_SEVERITY_RANK: dict[str, int] = {"critical": 0, "warning": 1, "info": 2}


def _days_until(end_date: date, today: date) -> int:
    return (end_date - today).days


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
        if gs and gs.notice_notification_days and 1 <= gs.notice_notification_days <= 365
        else 30
    )

    query = select(License).where(License.is_retired.is_(False)).options(selectinload(License.documents))
    departments = None
    if current_user.role == UserRole.viewer:
        departments = await get_viewer_departments(current_user.id, db)
    result = await db.execute(apply_department_filter(query, departments))
    licenses = list(result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, licenses)

    today = date.today()
    notifications: list[NotificationItem] = []

    for lic in licenses:
        # Skip legacy licenses entirely - no expiration or completeness alerts
        if lic.lifecycle_status == "legacy":
            continue

        docs = [
            *list(lic.documents),
            *procurement_documents_by_license_id.get(lic.id, []),
        ]
        is_renewed = lic.lifecycle_status == "renewed"
        is_upcoming = lic.start_date is not None and lic.start_date > today

        # ------------------------------------------------------------------
        # Expired - end_date in the past; skip licenses already renewed
        # ------------------------------------------------------------------
        if lic.end_date is not None and lic.end_date < today and not is_renewed and not is_upcoming:
            days_overdue = (today - lic.end_date).days
            day_word = "day" if days_overdue == 1 else "days"
            notifications.append(
                NotificationItem(
                    license_id=lic.id,
                    software_name=lic.software_description,
                    publisher=lic.publisher_name,
                    type="expired",
                    detail=(f"Expired {days_overdue} {day_word} ago on {lic.end_date.isoformat()}"),
                    severity="critical",
                    relevant_date=lic.end_date,
                )
            )

        # ------------------------------------------------------------------
        # Expiring soon - end_date within the next N days; skip renewed
        # ------------------------------------------------------------------
        elif lic.end_date is not None and not is_renewed and not is_upcoming:
            days_left = _days_until(lic.end_date, today)
            if 0 <= days_left <= expiry_window_days:
                if days_left <= 30:
                    severity = "critical"
                elif days_left <= 60:
                    severity = "warning"
                else:
                    severity = "info"

                day_word = "day" if days_left == 1 else "days"
                notifications.append(
                    NotificationItem(
                        license_id=lic.id,
                        software_name=lic.software_description,
                        publisher=lic.publisher_name,
                        type="expiring",
                        detail=(f"Expires in {days_left} {day_word} on {lic.end_date.isoformat()}"),
                        severity=severity,
                        relevant_date=lic.end_date,
                    )
                )

        # ------------------------------------------------------------------
        # Notice deadline - internal manager reminder, independent of expiry
        # ------------------------------------------------------------------
        if lic.notice_date is not None and lic.notice_handled_at is None and not is_renewed and not is_upcoming:
            notice_days_left = _days_until(lic.notice_date, today)
            if notice_days_left < 0:
                days_overdue = abs(notice_days_left)
                day_word = "day" if days_overdue == 1 else "days"
                notifications.append(
                    NotificationItem(
                        license_id=lic.id,
                        software_name=lic.software_description,
                        publisher=lic.publisher_name,
                        type="notice_due",
                        detail=(f"Notice deadline passed {days_overdue} {day_word} ago on {lic.notice_date.isoformat()}"),
                        severity="critical",
                        relevant_date=lic.notice_date,
                    )
                )
            elif notice_days_left <= notice_window_days:
                if notice_days_left <= 7:
                    severity = "critical"
                elif notice_days_left <= 30:
                    severity = "warning"
                else:
                    severity = "info"
                day_word = "day" if notice_days_left == 1 else "days"
                notifications.append(
                    NotificationItem(
                        license_id=lic.id,
                        software_name=lic.software_description,
                        publisher=lic.publisher_name,
                        type="notice_due",
                        detail=(f"Notice deadline in {notice_days_left} {day_word} on {lic.notice_date.isoformat()}"),
                        severity=severity,
                        relevant_date=lic.notice_date,
                    )
                )

        # ------------------------------------------------------------------
        # Incomplete - completeness below threshold; skip renewed/exempt
        # ------------------------------------------------------------------
        if not is_renewed and not lic.is_completeness_exempt:
            completeness = compute_completeness(lic, docs, mandatory_fields)
            if completeness is not None and completeness < _INCOMPLETE_THRESHOLD:
                notifications.append(
                    NotificationItem(
                        license_id=lic.id,
                        software_name=lic.software_description,
                        publisher=lic.publisher_name,
                        type="incomplete",
                        detail=(f"Record is {completeness}% complete (below {_INCOMPLETE_THRESHOLD}%)"),
                        severity="info",
                        relevant_date=lic.end_date,
                    )
                )

    # Sort: critical → warning → info, then earliest relevant_date first (None last)
    notifications.sort(
        key=lambda n: (
            _SEVERITY_RANK[n.severity],
            (0, n.relevant_date) if n.relevant_date is not None else (1, date.max),
        )
    )

    return notifications

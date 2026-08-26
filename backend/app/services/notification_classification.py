"""Shared eligibility and severity rules for license notifications."""

from __future__ import annotations

from datetime import date
from typing import Any

from app.services.license_service import compute_completeness, compute_expiration_status


INCOMPLETE_COMPLETENESS_THRESHOLD = 100
SEVERITY_RANK: dict[str, int] = {"critical": 0, "warning": 1, "info": 2}


def is_incomplete_completeness(completeness: int | None) -> bool:
    """Return whether a non-exempt completeness result is incomplete."""
    return completeness is not None and completeness < INCOMPLETE_COMPLETENESS_THRESHOLD


def _notice_severity(days: int) -> str:
    if days <= 7:
        return "critical"
    if days <= 30:
        return "warning"
    return "info"


def _expiry_severity(days: int) -> str:
    if days <= 30:
        return "critical"
    if days <= 60:
        return "warning"
    return "info"


def _day_word(days: int) -> str:
    return "day" if abs(days) == 1 else "days"


def _alert(
    license_obj: Any,
    alert_type: str,
    detail: str,
    severity: str,
    relevant_date: date | None,
    days_until_expiry: int | None = None,
    completeness_pct: int | None = None,
) -> dict[str, Any]:
    return {
        "license_id": license_obj.id,
        "software_name": license_obj.software_description,
        "publisher": license_obj.publisher_name,
        "software_description": license_obj.software_description,
        "publisher_name": license_obj.publisher_name,
        "budget_owner_email": license_obj.budget_owner_email or "",
        "type": alert_type,
        "detail": detail,
        "severity": severity,
        "relevant_date": relevant_date,
        "days_until_expiry": days_until_expiry,
        "notice_date": license_obj.notice_date.isoformat() if license_obj.notice_date else "",
        "completeness_pct": completeness_pct,
    }


def classify_license_alerts(
    license_obj: Any,
    documents: list[Any],
    mandatory_fields: dict[str, bool],
    expiry_window_days: int,
    notice_window_days: int,
    *,
    today: date | None = None,
    expiry_notifications_enabled: bool = True,
) -> list[dict[str, Any]]:
    """Return all eligible alerts for one visible, non-retired license.

    Legacy and renewed records are excluded from every alert category. Upcoming
    records are excluded from expiry and notice alerts but may still be
    incomplete. The expiry flag is intentionally a delivery-specific option:
    in-app callers leave it enabled, while email callers pass the license's
    renewal-notification setting.
    """
    today = today or date.today()
    lifecycle_status = getattr(license_obj.lifecycle_status, "value", license_obj.lifecycle_status)
    if license_obj.is_retired or lifecycle_status in {"legacy", "renewed"}:
        return []

    expiration_status = compute_expiration_status(license_obj, today, expiry_window_days)
    is_upcoming = expiration_status == "upcoming"
    alerts: list[dict[str, Any]] = []

    if expiry_notifications_enabled and not is_upcoming:
        if expiration_status == "expired" and license_obj.end_date is not None:
            days_overdue = (today - license_obj.end_date).days
            alerts.append(
                _alert(
                    license_obj,
                    "expired",
                    f"Expired {days_overdue} {_day_word(days_overdue)} ago on {license_obj.end_date.isoformat()}",
                    "critical",
                    license_obj.end_date,
                    -days_overdue,
                )
            )
        elif expiration_status == "expiring" and license_obj.end_date is not None:
            days_left = (license_obj.end_date - today).days
            alerts.append(
                _alert(
                    license_obj,
                    "expiring",
                    f"Expires in {days_left} {_day_word(days_left)} on {license_obj.end_date.isoformat()}",
                    _expiry_severity(days_left),
                    license_obj.end_date,
                    days_left,
                )
            )

    if (
        license_obj.notice_date is not None
        and license_obj.notice_handled_at is None
        and not is_upcoming
    ):
        notice_days_left = (license_obj.notice_date - today).days
        if notice_days_left <= notice_window_days:
            if notice_days_left < 0:
                days_overdue = abs(notice_days_left)
                detail = (
                    f"Notice deadline passed {days_overdue} {_day_word(days_overdue)} ago "
                    f"on {license_obj.notice_date.isoformat()}"
                )
                severity = "critical"
            else:
                detail = (
                    f"Notice deadline in {notice_days_left} {_day_word(notice_days_left)} "
                    f"on {license_obj.notice_date.isoformat()}"
                )
                severity = _notice_severity(notice_days_left)
            alerts.append(
                _alert(
                    license_obj,
                    "notice_due",
                    detail,
                    severity,
                    license_obj.notice_date,
                    notice_days_left,
                )
            )

    if not license_obj.is_completeness_exempt:
        completeness = compute_completeness(license_obj, documents, mandatory_fields)
        if is_incomplete_completeness(completeness):
            alerts.append(
                _alert(
                    license_obj,
                    "incomplete",
                    f"Record is {completeness}% complete (below {INCOMPLETE_COMPLETENESS_THRESHOLD}%)",
                    "info",
                    license_obj.end_date,
                    completeness_pct=completeness,
                )
            )

    return alerts


def sort_alerts(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort alerts using the product's critical-to-informational order."""
    return sorted(
        alerts,
        key=lambda alert: (
            SEVERITY_RANK[alert["severity"]],
            (0, alert["relevant_date"]) if alert["relevant_date"] is not None else (1, date.max),
        ),
    )

"""Notification delivery workflow and its database-backed run guard."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License
from app.models.settings import GlobalSettings
from app.services.document_availability_service import available_documents
from app.services.email_service import send_email
from app.services.email_templates import budget_owner_alert, manager_digest
from app.services.email_validation import is_email_domain_allowed, sanitize_email_header
from app.services.license_response_service import get_procurement_documents_by_scope
from app.services.notification_classification import classify_license_alerts
from app.services.settings_service import invalidate_global_settings_cache

log = logging.getLogger(__name__)

_MANAGER_DIGEST_TYPES = frozenset({"expired", "expiring", "notice_due", "incomplete"})
_RUN_LOCK_STALE_AFTER = timedelta(minutes=15)


def notification_run_succeeded(summary: dict) -> bool:
    """Return whether a run completed successfully enough to record success."""
    if "status" not in summary:
        if summary.get("skipped"):
            return False
        return not summary.get("errors")
    return summary.get("status") in {"success", "no_work"}


def _budget_owner_cc_candidates(
    owner_email: str,
    licenses_list: list[dict[str, Any]],
    manager_email: str | None,
) -> list[tuple[str, str]]:
    seen = {owner_email.casefold()}
    candidates: list[tuple[str, str]] = []
    for license_entry in licenses_list:
        for email in license_entry.get("secondary_contacts", []) or []:
            normalized = (email or "").strip()
            if normalized and normalized.casefold() not in seen:
                seen.add(normalized.casefold())
                candidates.append(("secondary_contact", normalized))
    manager = (manager_email or "").strip()
    if manager and manager.casefold() not in seen:
        candidates.append(("manager", manager))
    return candidates


def _blocked_delivery(recipient: str, role: str) -> dict[str, str]:
    return {
        "recipient": recipient,
        "role": role,
        "reason": "domain_not_allowed",
    }


def _delivery_error(recipient: str | None, role: str, exc: Exception) -> dict[str, str | None]:
    message = "Delivery failed"
    detail = str(exc).replace("\r", " ").replace("\n", " ").strip()
    if detail:
        message = detail[:300]
    return {"recipient": recipient, "role": role, "message": message}


def _status_for_summary(summary: dict[str, Any]) -> str:
    if summary["total_notifications"] == 0:
        return "no_work"
    delivered = summary["budget_owner_emails_sent"] + int(summary["digest_sent"])
    has_blocked = bool(summary["blocked"])
    has_errors = bool(summary["errors"])
    if summary["intended_messages"] == 0:
        return "failed"
    if not has_blocked and not has_errors and delivered == summary["intended_messages"]:
        return "success"
    if delivered:
        return "partial"
    if has_blocked and not has_errors:
        return "blocked"
    return "failed"


async def _claim_notification_run(db: AsyncSession, now: datetime | None = None) -> str | None:
    """Atomically claim the singleton run slot, recovering stale claims."""
    now = now or datetime.now(timezone.utc)
    token = uuid.uuid4().hex
    stale_before = now - _RUN_LOCK_STALE_AFTER
    result = await db.execute(
        update(GlobalSettings)
        .where(
            GlobalSettings.id == 1,
            or_(
                GlobalSettings.notification_run_token.is_(None),
                GlobalSettings.notification_run_started_at.is_(None),
                GlobalSettings.notification_run_started_at < stale_before,
            ),
        )
        .values(
            notification_run_token=token,
            notification_run_started_at=now,
            last_notification_attempt_date=now.date(),
        )
    )
    if result.rowcount != 1:
        await db.rollback()
        return None
    await db.commit()
    return token


async def _refresh_notification_run(
    db: AsyncSession,
    token: str,
    now: datetime | None = None,
) -> bool:
    """Refresh an owned run lease so an active long run is not considered stale."""
    result = await db.execute(
        update(GlobalSettings)
        .where(GlobalSettings.id == 1, GlobalSettings.notification_run_token == token)
        .values(notification_run_started_at=now or datetime.now(timezone.utc))
    )
    if result.rowcount != 1:
        await db.rollback()
        return False
    await db.commit()
    return True


async def _require_notification_run_ownership(db: AsyncSession, token: str) -> None:
    if not await _refresh_notification_run(db, token):
        raise RuntimeError("Notification run lease ownership was lost")


def _persistable_summary(summary: dict[str, Any]) -> dict[str, Any]:
    """Keep the admin-visible persisted summary compact and non-secret."""
    return {
        "status": summary.get("status"),
        "total_notifications": summary.get("total_notifications", 0),
        "intended_messages": summary.get("intended_messages", 0),
        "budget_owner_emails_sent": summary.get("budget_owner_emails_sent", 0),
        "digest_sent": bool(summary.get("digest_sent")),
        "blocked_owner_count": summary.get("blocked_owner_count", 0),
        "blocked_secondary_contact_count": summary.get("blocked_secondary_contact_count", 0),
        "blocked_manager_count": summary.get("blocked_manager_count", 0),
        "blocked": summary.get("blocked", [])[:100],
        "error_count": len(summary.get("errors", [])),
    }


async def _finalize_notification_run(
    db: AsyncSession,
    token: str,
    summary: dict[str, Any],
) -> None:
    """Finalize only the run that owns *token* and release the claim."""
    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "last_notification_status": summary["status"],
        "last_notification_at": now,
        "last_notification_summary": _persistable_summary(summary),
        "notification_run_token": None,
        "notification_run_started_at": None,
    }
    if notification_run_succeeded(summary):
        values["last_notification_sent_date"] = now.date()
    result = await db.execute(
        update(GlobalSettings)
        .where(GlobalSettings.id == 1, GlobalSettings.notification_run_token == token)
        .values(**values)
    )
    if result.rowcount != 1:
        await db.rollback()
        log.warning("Notification run %s no longer owns the finalization slot", token)
        return
    await db.commit()
    invalidate_global_settings_cache()


async def _deliver_notifications(
    db: AsyncSession,
    gs: GlobalSettings,
    token: str,
) -> dict[str, Any]:
    expiry_window_days = gs.notification_days or 30
    notice_window_days = gs.notice_notification_days or 30
    mandatory_fields = gs.mandatory_fields or {}
    today = date.today()
    allowed_domains = [d.strip() for d in (gs.allowed_email_domains or "").split(",") if d.strip()]

    lic_result = await db.execute(
        select(License).where(License.is_retired.is_(False)).options(selectinload(License.documents))
    )
    all_licenses = list(lic_result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, all_licenses)

    parent_ids = {lic.parent_license_id for lic in all_licenses if lic.parent_license_id is not None}
    parent_map: dict[int, License] = {}
    if parent_ids:
        parent_result = await db.execute(select(License).where(License.id.in_(parent_ids)))
        parent_map = {parent.id: parent for parent in parent_result.scalars().all()}

    expiring_by_owner: dict[str, list[dict[str, Any]]] = {}
    all_notifications: list[dict[str, Any]] = []
    for license_obj in all_licenses:
        documents = available_documents(
            [
                *list(license_obj.documents),
                *procurement_documents_by_license_id.get(license_obj.id, []),
            ],
            gs.storage_path or None,
        )
        alerts = classify_license_alerts(
            license_obj,
            documents,
            mandatory_fields,
            expiry_window_days,
            notice_window_days,
            today=today,
            expiry_notifications_enabled=getattr(license_obj, "renewal_notifications_enabled", True),
        )
        for alert in alerts:
            entry = _build_license_entry(license_obj, alert, parent_map=parent_map)
            all_notifications.append(entry)
            if alert["type"] in {"expired", "expiring"} and license_obj.budget_owner_email:
                expiring_by_owner.setdefault(license_obj.budget_owner_email, []).append(entry)

    summary: dict[str, Any] = {
        "status": "",
        "budget_owner_emails_sent": 0,
        "digest_sent": False,
        "total_notifications": len(all_notifications),
        "intended_messages": len(expiring_by_owner),
        "errors": [],
        "blocked": [],
        "blocked_owner_count": 0,
        "blocked_secondary_contact_count": 0,
        "blocked_manager_count": 0,
    }

    for owner_email, licenses_list in expiring_by_owner.items():
        await _require_notification_run_ownership(db, token)
        owner_allowed = is_email_domain_allowed(owner_email, allowed_domains)
        if not owner_allowed:
            summary["blocked"].append(_blocked_delivery(owner_email, "budget_owner"))
            summary["blocked_owner_count"] += 1

        cc: list[str] = []
        for role, recipient in _budget_owner_cc_candidates(owner_email, licenses_list, gs.manager_email):
            if is_email_domain_allowed(recipient, allowed_domains):
                if owner_allowed:
                    cc.append(recipient)
            else:
                summary["blocked"].append(_blocked_delivery(recipient, role))
                if role == "secondary_contact":
                    summary["blocked_secondary_contact_count"] += 1
                else:
                    summary["blocked_manager_count"] += 1

        if not owner_allowed:
            log.warning("Skipping notification owner %s because its domain is not allowed", owner_email)
            continue

        try:
            html = budget_owner_alert(
                licenses_list,
                intro_text=gs.email_template_budget_owner_intro or None,
                signoff_text=gs.email_template_budget_owner_signoff or None,
            )
            if len(licenses_list) == 1:
                license_entry = licenses_list[0]
                subject = (
                    f"License Lifecycle: {license_entry['software_description']}"
                    f" ({license_entry['publisher_name']}) - upcoming renewal notification"
                )
            else:
                subject = f"License Lifecycle: {len(licenses_list)} licenses requiring your attention"
            await send_email(gs, owner_email, sanitize_email_header(subject), html, cc=cc)
            summary["budget_owner_emails_sent"] += 1
        except Exception as exc:
            log.error("Failed to email notification owner %s: %s", owner_email, exc)
            summary["errors"].append(_delivery_error(owner_email, "budget_owner", exc))

    has_manager_notifications = any(n["type"] in _MANAGER_DIGEST_TYPES for n in all_notifications)
    if gs.manager_email and has_manager_notifications:
        await _require_notification_run_ownership(db, token)
        summary["intended_messages"] += 1
        if not is_email_domain_allowed(gs.manager_email, allowed_domains):
            summary["blocked"].append(_blocked_delivery(gs.manager_email, "manager"))
            summary["blocked_manager_count"] += 1
            log.warning("Skipping manager digest %s because its domain is not allowed", gs.manager_email)
        else:
            try:
                html = manager_digest(
                    all_notifications,
                    intro_text=gs.email_template_manager_intro or None,
                )
                counts = {
                    alert_type: sum(1 for n in all_notifications if n["type"] == alert_type)
                    for alert_type in ("expired", "expiring", "notice_due", "incomplete")
                }
                subject = (
                    "License Lifecycle Daily Summary: "
                    f"{counts['expired']} expired, "
                    f"{counts['expiring']} expiring, "
                    f"{counts['notice_due']} notice deadline, "
                    f"{counts['incomplete']} incomplete"
                )
                await send_email(gs, gs.manager_email, sanitize_email_header(subject), html)
                summary["digest_sent"] = True
            except Exception as exc:
                log.error("Failed to send digest to %s: %s", gs.manager_email, exc)
                summary["errors"].append(_delivery_error(gs.manager_email, "manager", exc))
    elif has_manager_notifications and not gs.manager_email:
        summary["errors"].append(
            _delivery_error(None, "manager", ValueError("Manager digest recipient is not configured"))
        )

    if summary["total_notifications"] > 0 and summary["intended_messages"] == 0 and not summary["errors"]:
        summary["errors"].append(
            _delivery_error(None, "configuration", ValueError("No notification recipients are configured"))
        )
    summary["status"] = _status_for_summary(summary)
    log.info("Daily notifications complete: %s", _persistable_summary(summary))
    return summary


async def run_daily_notifications(db: AsyncSession) -> dict[str, Any]:
    """Claim, deliver, and finalize one notification run."""
    gs = (await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))).scalar_one_or_none()
    if not gs:
        return {"status": "skipped", "skipped": True, "reason": "settings_not_configured"}

    token = await _claim_notification_run(db)
    if token is None:
        return {"status": "conflict", "reason": "notification_run_in_progress"}

    await db.refresh(gs)
    if not gs.smtp_host:
        summary: dict[str, Any] = {"status": "skipped", "skipped": True, "reason": "smtp_not_configured"}
    elif not gs.email_enabled:
        summary = {"status": "skipped", "skipped": True, "reason": "email_disabled"}
    else:
        try:
            summary = await _deliver_notifications(db, gs, token)
        except Exception as exc:
            log.error("Daily notification delivery failed before completion: %s", exc, exc_info=True)
            summary = {
                "status": "failed",
                "total_notifications": 0,
                "intended_messages": 0,
                "budget_owner_emails_sent": 0,
                "digest_sent": False,
                "blocked": [],
                "blocked_owner_count": 0,
                "blocked_secondary_contact_count": 0,
                "blocked_manager_count": 0,
                "errors": [_delivery_error(None, "run", exc)],
            }

    try:
        await _finalize_notification_run(db, token, summary)
    except Exception:
        await db.rollback()
        log.error("Failed to persist notification run outcome", exc_info=True)
    return summary


def _build_license_entry(
    license_obj: License,
    alert: dict[str, Any],
    parent_map: dict[int, License] | None = None,
) -> dict[str, Any]:
    entry = {
        **alert,
        "type": alert["type"],
        "license_type": license_obj.license_type.value if license_obj.license_type else "",
        "start_date": license_obj.start_date.isoformat() if license_obj.start_date else "",
        "end_date": license_obj.end_date.isoformat() if license_obj.end_date else "",
        "quantity": license_obj.quantity or "",
        "cost_centre": license_obj.cost_centre or "",
        "contract_number": license_obj.contract_number or "",
        "po_number": license_obj.po_number or "",
        "contact_email": license_obj.contact_email or "",
        "budget_owner_email": license_obj.budget_owner_email or "",
        "secondary_contacts": list(license_obj.secondary_contacts or []),
        "parent_license_id": license_obj.parent_license_id,
        "parent_publisher_name": None,
        "parent_software_description": None,
    }
    if license_obj.parent_license_id and parent_map:
        parent = parent_map.get(license_obj.parent_license_id)
        if parent is not None:
            entry["parent_publisher_name"] = parent.publisher_name
            entry["parent_software_description"] = parent.software_description
    return entry

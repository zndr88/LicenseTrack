import logging
from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.license import License
from app.models.settings import GlobalSettings
from app.services.license_service import compute_completeness
from app.services.email_service import send_email
from app.services.email_templates import budget_owner_alert, manager_digest

log = logging.getLogger(__name__)


def notification_run_succeeded(summary: dict) -> bool:
    """Return True if a notification run reached a conclusive, non-failing outcome.

    A run "succeeded" when it either delivered everything it intended with no
    delivery errors, or deliberately did nothing (SMTP not configured / email
    disabled). It did NOT succeed when one or more sends failed, which is the
    signal the scheduler uses to leave the day open for a manual retry instead
    of silently marking it handled.
    """
    if summary.get("skipped"):
        return True
    return not summary.get("errors")


def _is_domain_allowed(email: str, allowed: list[str]) -> bool:
    """Return True if email's domain is in the whitelist, or if the whitelist is empty."""
    if not allowed:
        return True
    domain = email.split("@")[-1].lower().strip()
    return domain in [d.lower().strip() for d in allowed]


async def run_daily_notifications(db: AsyncSession) -> dict:
    """
    Run the daily notification check. Returns a summary dict with
    counts of emails sent for logging purposes.
    """

    # Load settings
    result = await db.execute(
        select(GlobalSettings).where(GlobalSettings.id == 1)
    )
    gs = result.scalar_one_or_none()
    if not gs or not gs.smtp_host:
        log.info("SMTP not configured — skipping notifications")
        return {"skipped": True, "reason": "smtp_not_configured"}
    if not gs.email_enabled:
        log.info("Email notifications disabled — skipping")
        return {"skipped": True, "reason": "email_disabled"}

    notification_days = gs.notification_days or 30
    mandatory_fields = gs.mandatory_fields or {}
    today = date.today()
    allowed_domains = [d.strip() for d in (gs.allowed_email_domains or "").split(",") if d.strip()]

    # Load licenses
    lic_result = await db.execute(
        select(License)
        .where(License.is_retired.is_(False))
        .options(selectinload(License.documents))
    )
    all_licenses = list(lic_result.scalars().all())

    # Build lookup for parent licenses of any maintenance Licenses we
    # encounter -- used for email copy context
    parent_ids = {
        lic.parent_license_id for lic in all_licenses
        if lic.parent_license_id is not None
    }
    parent_map: dict[int, License] = {}
    if parent_ids:
        pr = await db.execute(
            select(License).where(License.id.in_(parent_ids))
        )
        for p in pr.scalars().all():
            parent_map[p.id] = p

    # Categorize
    expiring_by_owner: dict[str, list] = {}
    all_notifications = []

    for lic in all_licenses:
        if lic.lifecycle_status in ("legacy", "renewed"):
            continue

        docs = list(lic.documents)

        # Check expiration
        if lic.end_date is not None:
            days_left = (lic.end_date - today).days

            if days_left < 0:
                # Expired
                entry = _build_license_entry(
                    lic, "expired", days_left, parent_map=parent_map
                )
                all_notifications.append(entry)
                if lic.budget_owner_email:
                    expiring_by_owner.setdefault(
                        lic.budget_owner_email, []
                    ).append(entry)

            elif 0 <= days_left <= notification_days:
                # Expiring within threshold
                entry = _build_license_entry(
                    lic, "expiring", days_left, parent_map=parent_map
                )
                all_notifications.append(entry)
                if lic.budget_owner_email:
                    expiring_by_owner.setdefault(
                        lic.budget_owner_email, []
                    ).append(entry)

        # Check completeness
        if not lic.is_completeness_exempt:
            completeness = compute_completeness(lic, docs, mandatory_fields)
            if completeness is not None and completeness < 80:
                all_notifications.append(
                    _build_license_entry(
                        lic,
                        "incomplete",
                        None,
                        completeness,
                        parent_map=parent_map,
                    )
                )

    # Send budget owner emails
    errors = []
    budget_owner_count = 0
    for owner_email, licenses_list in expiring_by_owner.items():
        if not _is_domain_allowed(owner_email, allowed_domains):
            log.warning(f"Skipping email to {owner_email} — domain not in whitelist")
            continue
        try:
            html = budget_owner_alert(
                licenses_list,
                intro_text=gs.email_template_budget_owner_intro or None,
                signoff_text=gs.email_template_budget_owner_signoff or None,
            )
            owner_licenses = licenses_list
            if len(owner_licenses) == 1:
                lic = owner_licenses[0]
                subject = (
                    f"License Lifecycle: {lic['software_description']}"
                    f" ({lic['publisher_name']})"
                    f" - upcoming renewal notification"
                )
            else:
                subject = f"License Lifecycle: {len(owner_licenses)} licenses requiring your attention"
            cc = gs.manager_email if gs.manager_email and gs.manager_email != owner_email else None
            await send_email(gs, owner_email, subject, html, cc=cc)
            budget_owner_count += 1
        except Exception as exc:
            log.error(f"Failed to email {owner_email}: {exc}")
            errors.append(f"{owner_email}: {exc}")

    # Send manager digest
    digest_sent = False
    if gs.manager_email and not _is_domain_allowed(gs.manager_email, allowed_domains):
        log.warning(f"Skipping digest to {gs.manager_email} — domain not in whitelist")
    has_expiry_notifications = any(n["type"] in ("expired", "expiring") for n in all_notifications)
    if gs.manager_email and has_expiry_notifications and _is_domain_allowed(gs.manager_email, allowed_domains):
        try:
            html = manager_digest(
                all_notifications,
                intro_text=gs.email_template_manager_intro or None,
            )
            expired_count = sum(
                1 for n in all_notifications if n["type"] == "expired"
            )
            expiring_count = sum(
                1 for n in all_notifications if n["type"] == "expiring"
            )
            incomplete_count = sum(
                1 for n in all_notifications if n["type"] == "incomplete"
            )
            subject = (
                f"License Lifecycle Daily Summary: "
                f"{expired_count} expired, "
                f"{expiring_count} expiring, "
                f"{incomplete_count} incomplete"
            )
            await send_email(gs, gs.manager_email, subject, html)
            digest_sent = True
        except Exception as exc:
            log.error(f"Failed to send digest to {gs.manager_email}: {exc}")
            errors.append(f"digest: {exc}")

    summary = {
        "budget_owner_emails_sent": budget_owner_count,
        "digest_sent": digest_sent,
        "total_notifications": len(all_notifications),
        "errors": errors,
    }
    log.info(f"Daily notifications complete: {summary}")
    return summary


def _build_license_entry(
    lic,
    alert_type,
    days_left,
    completeness=None,
    parent_map=None,
):
    entry = {
        "type": alert_type,
        "license_id": lic.id,
        "license_type": lic.license_type.value if lic.license_type else "",
        "software_description": lic.software_description,
        "publisher_name": lic.publisher_name,
        "start_date": lic.start_date.isoformat() if lic.start_date else "",
        "end_date": lic.end_date.isoformat() if lic.end_date else "",
        "days_until_expiry": days_left,
        "quantity": lic.quantity or "",
        "cost_centre": lic.cost_centre or "",
        "contract_number": lic.contract_number or "",
        "po_number": lic.po_number or "",
        "contact_email": lic.contact_email or "",
        "budget_owner_email": lic.budget_owner_email or "",
        "completeness_pct": completeness,
        "parent_license_id": lic.parent_license_id,
        "parent_publisher_name": None,
        "parent_software_description": None,
    }
    if lic.parent_license_id and parent_map:
        parent = parent_map.get(lic.parent_license_id)
        if parent is not None:
            entry["parent_publisher_name"] = parent.publisher_name
            entry["parent_software_description"] = parent.software_description
    return entry

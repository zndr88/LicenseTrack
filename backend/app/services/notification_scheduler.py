import asyncio
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete, select
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.settings import GlobalSettings
from app.services.notification_sender import run_daily_notifications
from app.services.pending_order_conversion_service import sweep_stale_evidence_transfers
from app.services.webhook_service import dispatch_pending_webhooks

log = logging.getLogger(__name__)


def _seconds_until_hour(now: datetime, hour: int) -> float:
    """Return seconds from now until the next occurrence of the given hour (0-23)."""
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if now >= target:
        target = target + timedelta(days=1)
    return (target - now).total_seconds()


async def _prune_audit_log(retention_days: int) -> None:
    """Delete AuditLog rows older than retention_days. Logs but never raises."""
    try:
        # Strip tzinfo so the cutoff is a naive UTC datetime matching how
        # SQLite stores timestamps (as plain strings without timezone offset).
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)
        async with AsyncSessionLocal() as db:
            await db.execute(delete(AuditLog).where(AuditLog.timestamp < cutoff))
            await db.commit()
        log.info(f"Audit log pruned: entries older than {retention_days} days removed")
    except Exception as exc:
        log.error(f"Audit log pruning failed: {exc}", exc_info=True)


async def _write_backup_status(status: str) -> None:
    """Persist last_backup_status and last_backup_at to GlobalSettings."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
            gs = result.scalar_one_or_none()
            if gs:
                gs.last_backup_status = status
                gs.last_backup_at = datetime.now(timezone.utc)
                await db.commit()
    except Exception as exc:
        log.error(f"Failed to persist backup status: {exc}", exc_info=True)


async def _run_backup(gs: GlobalSettings) -> None:
    """Run create_backup + prune_backups if backup is enabled. Logs but never raises."""
    if not gs.backup_enabled:
        return
    from app.services.backup_service import run_routine_backup

    try:
        backup_location = str(gs.backup_location)
        backup_keep = int(gs.backup_keep)
        zip_path = await run_routine_backup(backup_location, backup_keep)
        log.info(f"Scheduled backup created: {zip_path}")
        await _write_backup_status("success")
        try:
            async with AsyncSessionLocal() as db:
                from app.services.audit_service import log_event

                await log_event(db, "system.scheduled_backup_succeeded", target_type="backup", target_label=zip_path.name, detail="outcome=success")
                await db.commit()
        except Exception:
            log.error("Scheduled backup success audit failed", exc_info=True)
    except Exception as exc:
        log.error(f"Scheduled backup failed: {exc}", exc_info=True)
        await _write_backup_status("failed")
        try:
            async with AsyncSessionLocal() as db:
                from app.services.audit_service import log_event

                await log_event(db, "system.scheduled_backup_failed", target_type="backup", detail="outcome=failure")
                await db.commit()
        except Exception:
            log.error("Scheduled backup failure audit failed", exc_info=True)


async def start_scheduler():
    """Background loop that runs notifications, backups, and audit log pruning once per day."""
    log.info("Notification scheduler started")

    # Run initial audit log prune shortly after startup
    await asyncio.sleep(5)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
            gs_init = result.scalar_one_or_none()
            retention_init = gs_init.audit_log_retention_days if gs_init else 90
        await _prune_audit_log(retention_init)
    except Exception as exc:
        log.error(f"Initial audit log prune failed: {exc}", exc_info=True)

    last_prune_day: int | None = None  # track calendar day of last prune

    while True:
        try:
            delivered_count = await dispatch_pending_webhooks()
            if delivered_count:
                log.info(f"Webhook dispatch attempted for {delivered_count} pending delivery record(s)")
        except Exception as exc:
            log.error(f"Webhook dispatch failed: {exc}", exc_info=True)

        try:
            swept_count = await sweep_stale_evidence_transfers()
            if swept_count:
                log.info(f"Evidence transfer sweep attempted for {swept_count} order(s)")
        except Exception as exc:
            log.error(f"Evidence transfer sweep failed: {exc}", exc_info=True)

        now = datetime.now(timezone.utc)

        # Load settings from GlobalSettings
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
                gs = result.scalar_one_or_none()
                send_hour = gs.notification_send_hour if gs else 7
                backup_hour = gs.backup_hour if gs else 2
                backup_enabled = gs.backup_enabled if gs else False
                retention_days = gs.audit_log_retention_days if gs else 90
        except Exception as exc:
            log.warning(f"Could not load scheduler settings from DB: {exc}. Using defaults.")
            send_hour = 7
            backup_hour = 2
            backup_enabled = False
            retention_days = 90

        # Sleep until whichever of the two jobs fires next
        notif_wait = _seconds_until_hour(now, send_hour)
        backup_wait = _seconds_until_hour(now, backup_hour) if backup_enabled else float("inf")
        wait_seconds = min(notif_wait, backup_wait)

        log.info(
            f"Next notification run in {notif_wait / 3600:.1f}h"
            + (f", next backup run in {backup_wait / 3600:.1f}h" if backup_enabled else "")
        )
        await asyncio.sleep(min(wait_seconds, 60))

        now_after = datetime.now(timezone.utc)

        # Run notifications if we're at or past the notification hour.
        notif_target = now.replace(hour=send_hour, minute=0, second=0, microsecond=0)
        if now >= notif_target:
            notif_target = notif_target + timedelta(days=1)
        if now_after >= notif_target:
            try:
                async with AsyncSessionLocal() as db:
                    gs_notif = (
                        await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
                    ).scalar_one_or_none()
                    today = now_after.date()
                    if gs_notif and gs_notif.last_notification_sent_date == today:
                        log.info("Notification run skipped - already sent successfully today")
                    elif gs_notif and gs_notif.last_notification_attempt_date == today:
                        # We already tried automatically today and it did not fully
                        # succeed. Do not auto-retry every loop iteration; leave the
                        # day open so an admin can retry via the manual trigger.
                        log.info(
                            "Notification run skipped - already attempted today without "
                            "success; use the manual trigger to retry"
                        )
                    else:
                        summary = await run_daily_notifications(db)
                        if summary.get("status") == "conflict":
                            log.info("Scheduled notification run skipped because another run is active")
                        elif summary.get("status") in {"success", "no_work", "skipped"}:
                            log.info(f"Notification run complete: {summary}")
                        else:
                            log.warning(
                                f"Notification run had delivery failures, day left open for manual retry: {summary}"
                            )
            except Exception as exc:
                log.error(f"Notification run failed: {exc}", exc_info=True)

        # Run backup if enabled and we're at or past the backup hour
        if backup_enabled:
            backup_target = now.replace(hour=backup_hour, minute=0, second=0, microsecond=0)
            if now >= backup_target:
                backup_target = backup_target + timedelta(days=1)
            if now_after >= backup_target:
                try:
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
                        gs_fresh = result.scalar_one_or_none()
                    if gs_fresh:
                        await _run_backup(gs_fresh)
                except Exception as exc:
                    log.error(f"Backup job failed to load settings: {exc}", exc_info=True)

        # Run audit log prune once per calendar day (at notification time or backup time)
        today_day = now_after.date().day
        if last_prune_day != today_day:
            await _prune_audit_log(retention_days)
            last_prune_day = today_day

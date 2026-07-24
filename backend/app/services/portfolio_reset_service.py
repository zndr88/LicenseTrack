"""Fixed-scope portfolio reset workflow for pre-production clean starts."""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.models.audit_log import AuditLog
from app.models.contract import Contract, ContractDocument, ContractFolder
from app.models.custom_fields import CustomFieldValue
from app.models.document import Document, ProcurementDocument
from app.models.document_processing import DocumentProcessingResult
from app.models.license import License
from app.models.license_ref_seq import LicenseRefSequence
from app.models.pending_order import PendingOrder
from app.models.plugin_suggestion import PluginSuggestion
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.webhook import WebhookDelivery
from app.services.audit_service import log_event
from app.services.backup_service import (
    PORTFOLIO_STORAGE_DIRECTORIES,
    create_portfolio_reset_archive,
)
from app.services.settings_service import invalidate_global_settings_cache

logger = logging.getLogger(__name__)

PORTFOLIO_RESET_CONFIRMATION = "RESET PORTFOLIO"
_reset_lock = asyncio.Lock()


async def portfolio_counts(db: AsyncSession) -> dict[str, int]:
    """Return the user-facing record counts affected by a portfolio reset."""

    async def count(model) -> int:
        return int(await db.scalar(select(func.count()).select_from(model)) or 0)

    document_count = (
        await count(Document)
        + await count(ProcurementDocument)
        + await count(SourcingQuoteDocument)
        + await count(ContractDocument)
    )
    return {
        "licenses": await count(License),
        "sourcing_requests": await count(SourcingRequest),
        "sourcing_items": await count(SourcingItem),
        "pending_orders": await count(PendingOrder),
        "contracts": await count(Contract),
        "documents": document_count,
        "audit_events": await count(AuditLog),
    }


async def portfolio_document_paths(db: AsyncSession) -> list[str]:
    """Return every stored portfolio-document path that must be recoverable."""
    paths: list[str] = []
    for model in (Document, ProcurementDocument, SourcingQuoteDocument, ContractDocument):
        paths.extend(await db.scalars(select(model.filename)))
    return sorted(set(paths))


async def reset_portfolio(
    db: AsyncSession,
    *,
    actor,
    ip_address: str | None,
) -> dict:
    """
    Archive and delete all portfolio and procurement data while preserving
    accounts, settings, integrations, mappings, and extension configuration.
    """
    if _reset_lock.locked():
        raise RuntimeError("A portfolio reset is already in progress.")

    async with _reset_lock:
        # Authentication has already read through this session. End that
        # transaction, then take a SQLite write reservation so another request
        # cannot commit portfolio changes between the archive and deletion.
        await db.commit()
        await db.execute(text("BEGIN IMMEDIATE"))

        settings_row = await db.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
        backup_location = (
            settings_row.backup_location
            if settings_row is not None and settings_row.backup_location
            else app_settings.BACKUP_LOCATION
        )
        storage_location = (
            settings_row.storage_path
            if settings_row is not None and settings_row.storage_path
            else app_settings.STORAGE_PATH
        )
        counts = await portfolio_counts(db)
        document_paths = await portfolio_document_paths(db)

        try:
            archive_path = await asyncio.to_thread(
                create_portfolio_reset_archive,
                backup_location,
                storage_location,
                counts,
                document_paths,
            )
        except Exception:
            await db.rollback()
            raise

        try:
            # Break the only cross-table reference back into licenses before
            # deleting the lifecycle table. Self-references disappear together
            # in the table-wide License DELETE.
            await db.execute(update(SourcingItem).values(renewal_for_license_id=None))

            await db.execute(delete(DocumentProcessingResult))
            await db.execute(delete(PluginSuggestion))
            await db.execute(delete(CustomFieldValue))
            await db.execute(delete(Document))
            await db.execute(delete(ProcurementDocument))
            await db.execute(delete(SourcingQuoteDocument))
            await db.execute(delete(ContractDocument))
            await db.execute(delete(WebhookDelivery))

            await db.execute(delete(License))
            await db.execute(delete(SourcingItem))
            await db.execute(delete(SourcingRequest))
            await db.execute(delete(PendingOrder))
            await db.execute(delete(ContractFolder))
            await db.execute(delete(Contract))
            await db.execute(delete(AuditLog))

            sequence_result = await db.execute(
                update(LicenseRefSequence)
                .where(LicenseRefSequence.id == 1)
                .values(last_value=0)
            )
            if sequence_result.rowcount == 0:
                db.add(LicenseRefSequence(id=1, last_value=0))

            if settings_row is not None:
                settings_row.last_notification_sent_date = None
                settings_row.last_notification_attempt_date = None

            detail = "\n".join(
                [
                    "mutationType=portfolio_reset",
                    f"recoveryArchive={archive_path.name}",
                    *(f"{key}={value}" for key, value in counts.items()),
                ]
            )
            await log_event(
                db,
                "system.portfolio_reset",
                actor=actor,
                ip_address=ip_address,
                target_type="portfolio",
                target_label="Portfolio data",
                detail=detail,
            )
            await db.commit()
            invalidate_global_settings_cache()
        except Exception:
            await db.rollback()
            raise

        storage_cleanup_failed = False
        storage_root = Path(storage_location).resolve()
        for directory_name in PORTFOLIO_STORAGE_DIRECTORIES:
            managed_directory = (storage_root / directory_name).resolve()
            if managed_directory.parent != storage_root or not managed_directory.exists():
                continue
            try:
                shutil.rmtree(managed_directory)
            except OSError:
                storage_cleanup_failed = True
                logger.error(
                    "Portfolio rows were reset but stored files could not be removed from %s",
                    managed_directory,
                    exc_info=True,
                )

        return {
            "status": "completed",
            "archive_filename": archive_path.name,
            "counts": counts,
            "storage_cleanup_failed": storage_cleanup_failed,
            "next_license_ref": "LT-REF-00001",
        }

"""Schema upgrades: the one place that snapshots and runs Alembic to head.

Used by application startup (when RUN_MIGRATIONS_ON_STARTUP is on) and by the
separate upgrade command, ``python -m app.upgrade``.
"""

import logging
import os
import sys
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import AsyncEngine

from app.services.backup_service import create_pre_migration_snapshot

logger = logging.getLogger(__name__)


def alembic_config() -> AlembicConfig:
    # In a frozen PyInstaller bundle the alembic files live next to the
    # executable; otherwise alembic.ini is resolved from the working directory
    # (backend/), matching how the server is started.
    if getattr(sys, "frozen", False):
        return AlembicConfig(os.path.join(os.path.dirname(sys.executable), "alembic.ini"))
    return AlembicConfig("alembic.ini")


def upgrade_schema() -> Path | None:
    """Snapshot the database if an upgrade is pending, then upgrade to head.

    Returns the snapshot path, or None when no snapshot was needed. Raises if
    the snapshot or the upgrade fails; nothing is upgraded without a snapshot.
    """
    try:
        snapshot = create_pre_migration_snapshot()
    except Exception as exc:
        logger.critical("Could not snapshot the database before upgrading: %s", exc)
        logger.critical(
            "The application will not migrate without a rollback point. Common causes are low disk space "
            "or missing write permission on the database folder."
        )
        raise
    if snapshot is not None:
        logger.warning("Database schema upgrade pending; pre-upgrade snapshot: %s", snapshot)
    try:
        alembic_command.upgrade(alembic_config(), "head")
    except Exception as exc:
        logger.critical("Alembic migration failed: %s", exc)
        logger.critical("The application cannot start. Check your database and migration files.")
        raise
    return snapshot


async def schema_is_current(engine: AsyncEngine) -> bool:
    """True when the database is at this release's newest schema revision."""
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    async with engine.connect() as conn:
        current = await conn.run_sync(lambda sync_conn: MigrationContext.configure(sync_conn).get_current_revision())
    return current == head

"""Whole-job locks: only one app copy runs a given scheduled job at a time.

The lock lives in the database (``scheduler_job_locks``), so it holds across
processes and machines. A claim older than ``stale_after`` is treated as left
behind by a copy that stopped mid-run and can be taken over.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal
from app.models.scheduler_job_lock import SchedulerJobLock

log = logging.getLogger(__name__)

DEFAULT_STALE_AFTER = timedelta(minutes=30)


async def claim_job(
    name: str,
    *,
    stale_after: timedelta = DEFAULT_STALE_AFTER,
    session_factory=None,
    now: datetime | None = None,
) -> str | None:
    """Claim *name*; return the claim token, or None if another copy holds it."""
    factory = session_factory or AsyncSessionLocal
    now = now or datetime.now(timezone.utc)
    token = uuid.uuid4().hex
    async with factory() as db:
        result = await db.execute(
            update(SchedulerJobLock)
            .where(
                SchedulerJobLock.name == name,
                or_(
                    SchedulerJobLock.token.is_(None),
                    SchedulerJobLock.started_at.is_(None),
                    SchedulerJobLock.started_at < now - stale_after,
                ),
            )
            .values(token=token, started_at=now)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 1:
            await db.commit()
            return token
        await db.rollback()
        # No free row: either the job has never run (no row yet) or it is held.
        db.add(SchedulerJobLock(name=name, token=token, started_at=now))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return None
        return token


async def release_job(name: str, token: str, *, session_factory=None) -> None:
    """Release *name* if *token* still owns it."""
    factory = session_factory or AsyncSessionLocal
    async with factory() as db:
        await db.execute(
            update(SchedulerJobLock)
            .where(SchedulerJobLock.name == name, SchedulerJobLock.token == token)
            .values(token=None, started_at=None)
            .execution_options(synchronize_session=False)
        )
        await db.commit()


async def run_locked_job(
    name: str,
    job: Callable[[], Awaitable[Any]],
    *,
    skipped: Any = None,
    stale_after: timedelta = DEFAULT_STALE_AFTER,
    session_factory=None,
) -> Any:
    """Run *job* only if this copy can claim *name*; otherwise return *skipped*."""
    token = await claim_job(name, stale_after=stale_after, session_factory=session_factory)
    if token is None:
        log.info("Scheduled job %s skipped: another copy of the app is running it", name)
        return skipped
    try:
        return await job()
    finally:
        await release_job(name, token, session_factory=session_factory)

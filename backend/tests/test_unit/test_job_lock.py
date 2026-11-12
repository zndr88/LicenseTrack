"""Whole-job locks shared by every app copy using the same database."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.database import Base, configure_sqlite_connections
from app.models.scheduler_job_lock import SchedulerJobLock
from app.services.job_lock import claim_job, release_job, run_locked_job


@pytest.fixture
async def session_factory(tmp_path):
    # A file database: separate connections, like separate app copies.
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'locks.db').as_posix()}")
    configure_sqlite_connections(engine.sync_engine)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def test_first_claim_wins_and_second_is_refused(session_factory):
    first = await claim_job("job", session_factory=session_factory)
    second = await claim_job("job", session_factory=session_factory)
    assert first is not None
    assert second is None


async def test_release_frees_the_job(session_factory):
    token = await claim_job("job", session_factory=session_factory)
    await release_job("job", token, session_factory=session_factory)
    assert await claim_job("job", session_factory=session_factory) is not None


async def test_release_with_wrong_token_keeps_the_lock(session_factory):
    await claim_job("job", session_factory=session_factory)
    await release_job("job", "someone-else", session_factory=session_factory)
    assert await claim_job("job", session_factory=session_factory) is None


async def test_stale_claim_is_taken_over(session_factory):
    old = datetime.now(timezone.utc) - timedelta(hours=1)
    assert await claim_job("job", session_factory=session_factory, now=old) is not None
    assert await claim_job("job", session_factory=session_factory, stale_after=timedelta(minutes=30)) is not None


async def test_fresh_claim_is_not_taken_over(session_factory):
    recent = datetime.now(timezone.utc) - timedelta(minutes=5)
    assert await claim_job("job", session_factory=session_factory, now=recent) is not None
    assert await claim_job("job", session_factory=session_factory, stale_after=timedelta(minutes=30)) is None


async def test_different_jobs_do_not_block_each_other(session_factory):
    assert await claim_job("a", session_factory=session_factory) is not None
    assert await claim_job("b", session_factory=session_factory) is not None


async def test_two_copies_run_a_locked_job_once(session_factory):
    calls = 0

    async def job():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.2)
        return "ran"

    results = await asyncio.gather(
        run_locked_job("job", job, skipped="skipped", session_factory=session_factory),
        run_locked_job("job", job, skipped="skipped", session_factory=session_factory),
    )

    assert sorted(results) == ["ran", "skipped"]
    assert calls == 1


async def test_lock_is_released_when_the_job_fails(session_factory):
    async def failing():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await run_locked_job("job", failing, session_factory=session_factory)

    async with session_factory() as db:
        row = (await db.execute(select(SchedulerJobLock).where(SchedulerJobLock.name == "job"))).scalar_one()
    assert row.token is None
    assert row.started_at is None

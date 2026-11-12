"""SQLite connection settings: WAL, busy timeout, foreign keys, PO function."""

import asyncio
import sqlite3
import time

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine

import app.database as database
from app.database import configure_sqlite_connections


def _url(path) -> str:
    return f"sqlite+aiosqlite:///{path.as_posix()}"


async def _file_engine(path):
    engine = create_async_engine(_url(path))
    configure_sqlite_connections(engine.sync_engine)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
    return engine


async def test_file_database_uses_wal_busy_timeout_and_foreign_keys(tmp_path):
    engine = await _file_engine(tmp_path / "settings.db")
    try:
        async with engine.connect() as conn:
            assert (await conn.exec_driver_sql("PRAGMA journal_mode")).scalar_one() == "wal"
            assert (await conn.exec_driver_sql("PRAGMA busy_timeout")).scalar_one() == 15000
            assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
            assert (await conn.exec_driver_sql("SELECT licensetrack_normalize_po('  Po  12 ')")).scalar_one() == "po 12"
    finally:
        await engine.dispose()


async def test_memory_database_keeps_memory_journal():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    configure_sqlite_connections(engine.sync_engine)
    try:
        async with engine.connect() as conn:
            assert (await conn.exec_driver_sql("PRAGMA journal_mode")).scalar_one() == "memory"
            assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
    finally:
        await engine.dispose()


def _hold_write_lock(path):
    holder = sqlite3.connect(path, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")
    holder.execute("INSERT INTO t (v) VALUES ('holder')")
    return holder


async def test_writer_waits_for_a_held_lock_and_succeeds(tmp_path):
    path = tmp_path / "wait.db"
    engine = await _file_engine(path)
    holder = _hold_write_lock(path)
    try:
        asyncio.get_running_loop().call_later(1.0, holder.commit)
        started = time.monotonic()
        async with engine.begin() as conn:
            await conn.exec_driver_sql("INSERT INTO t (v) VALUES ('waiter')")
        assert time.monotonic() - started >= 0.9
        async with engine.connect() as conn:
            assert (await conn.exec_driver_sql("SELECT count(*) FROM t")).scalar_one() == 2
    finally:
        holder.close()
        await engine.dispose()


async def test_busy_timeout_setting_is_what_limits_the_wait(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "SQLITE_BUSY_TIMEOUT_MS", 200)
    path = tmp_path / "short.db"
    engine = await _file_engine(path)
    holder = _hold_write_lock(path)
    try:
        with pytest.raises(OperationalError, match="database is locked"):
            async with engine.begin() as conn:
                await conn.exec_driver_sql("INSERT INTO t (v) VALUES ('gives up')")
    finally:
        holder.rollback()
        holder.close()
        await engine.dispose()


async def test_concurrent_writers_all_succeed(tmp_path):
    engine = await _file_engine(tmp_path / "concurrent.db")
    try:

        async def writer(index: int) -> None:
            for round_ in range(20):
                async with engine.begin() as conn:
                    await conn.exec_driver_sql("SELECT count(*) FROM t")
                    await conn.exec_driver_sql("INSERT INTO t (v) VALUES (?)", (f"{index}-{round_}",))

        await asyncio.gather(*(writer(index) for index in range(6)))
        async with engine.connect() as conn:
            assert (await conn.exec_driver_sql("SELECT count(*) FROM t")).scalar_one() == 120
    finally:
        await engine.dispose()

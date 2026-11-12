from sqlalchemy import event
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings
from app.services.procurement_identity import normalize_po_number

# How long a connection waits for another connection's write before SQLite
# reports "database is locked" (answered with HTTP 503 by app.main). The
# driver default of 5 seconds was too short under concurrent writes.
SQLITE_BUSY_TIMEOUT_MS = 15_000


def _is_memory_database(url: URL) -> bool:
    database = url.database or ""
    return database in ("", ":memory:") or database.startswith("file::memory:") or "mode=memory" in database


def configure_sqlite_connections(sync_engine) -> None:
    """Apply LicenseTrack's settings to every SQLite connection of *sync_engine*.

    Foreign-key enforcement, the PO-normalization SQL function and the busy
    timeout apply to every connection. File databases also use WAL, so reads
    do not block writes. WAL keeps two companion files next to the database
    (``-wal`` and ``-shm``) and needs a local disk, not a network share.
    """
    if sync_engine.dialect.name != "sqlite":
        return
    use_wal = not _is_memory_database(sync_engine.url)

    @event.listens_for(sync_engine, "connect")
    def _configure(dbapi_connection, connection_record):
        dbapi_connection.create_function("licensetrack_normalize_po", 1, normalize_po_number, deterministic=True)
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # Read at connect time so tests can shorten it.
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        if use_wal:
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


engine = create_async_engine(settings.DATABASE_URL, echo=False)
configure_sqlite_connections(engine.sync_engine)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

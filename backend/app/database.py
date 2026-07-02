from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


def enable_sqlite_foreign_keys(sync_engine) -> None:
    """Register a connect listener that sets PRAGMA foreign_keys=ON for every SQLite connection."""
    if sync_engine.dialect.name != "sqlite":
        return

    @event.listens_for(sync_engine, "connect")
    def _set_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


engine = create_async_engine(settings.DATABASE_URL, echo=False)
enable_sqlite_foreign_keys(engine.sync_engine)

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

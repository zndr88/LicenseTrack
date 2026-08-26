"""Alembic environment - configured for async SQLAlchemy (aiosqlite).

DATABASE_URL is read from app.config (which reads .env), so alembic.ini
does NOT need a real sqlalchemy.url value - it is overridden below.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# ---------------------------------------------------------------------------
# Alembic config object
# ---------------------------------------------------------------------------
config = context.config

# Set up Python logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# Wire up the app's Base metadata + DATABASE_URL
# ---------------------------------------------------------------------------
# Import all models so their tables are registered on Base.metadata before
# autogenerate inspects it.
import app.models  # noqa: F401  (registers all ORM classes)
from app.database import Base
from app.config import settings

target_metadata = Base.metadata

# Restore validation can direct Alembic at a staged database. Normal CLI and
# startup migrations continue to use the configured application database.
database_url = config.attributes.get("database_url", settings.DATABASE_URL)
config.set_main_option("sqlalchemy.url", database_url)


# ---------------------------------------------------------------------------
# Offline migrations - emit SQL to stdout, no live DB connection needed
# ---------------------------------------------------------------------------
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online migrations - async engine, run_sync wrapper
# ---------------------------------------------------------------------------
def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Use a synchronous engine - aiosqlite is only needed
    # for runtime async queries, not for DDL. This avoids
    # asyncio.run() being called from a thread-pool executor
    # under uvloop on Linux, which deadlocks on signal handler
    # registration.
    sync_url = database_url.replace("+aiosqlite", "")
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        url=sync_url,
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        do_run_migrations(connection)
    connectable.dispose()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

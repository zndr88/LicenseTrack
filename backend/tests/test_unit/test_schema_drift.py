"""The ORM models must describe exactly the schema that the migrations build."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

import app.models  # noqa: F401  (registers every table)
from app.database import Base
from app.services.backup_service import _alembic_config


def test_migrations_and_models_describe_the_same_schema(tmp_path):
    db_path = tmp_path / "schema.db"
    command.upgrade(_alembic_config(db_path), "head")

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            differences = compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()

    assert differences == [], "\n".join(str(diff) for diff in differences)

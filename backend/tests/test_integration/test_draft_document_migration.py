"""Draft scope upgrade keeps historical evidence local and rolls back cleanly."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings


def test_draft_document_scope_upgrade_and_downgrade(tmp_path, monkeypatch):
    database_path = tmp_path / "draft-documents.sqlite"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database_path.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    command.upgrade(config, "c912ee470a63")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO sourcing_requests (id, status) VALUES (1, 'sourcing')"))
        connection.execute(
            text("""
            INSERT INTO sourcing_quote_documents
                (id, sourcing_request_id, filename, original_filename, file_size, mime_type)
            VALUES (1, 1, 'legacy.pdf', 'legacy.pdf', 10, 'application/pdf')
        """)
        )
    engine.dispose()
    command.upgrade(config, "d823fa681b94")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT category, shared_upload, target_sourcing_item_id FROM sourcing_quote_documents")
        ).one()
        assert tuple(row) == ("quote", 0, None)
        assert "target_sourcing_item_id" in {
            column["name"] for column in inspect(connection).get_columns("procurement_documents")
        }
    engine.dispose()
    command.downgrade(config, "c912ee470a63")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT filename FROM sourcing_quote_documents WHERE id = 1")) == "legacy.pdf"
        assert "category" not in {
            column["name"] for column in inspect(connection).get_columns("sourcing_quote_documents")
        }
        assert "target_sourcing_item_id" not in {
            column["name"] for column in inspect(connection).get_columns("procurement_documents")
        }
    engine.dispose()

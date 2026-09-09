"""The new sharing marker must never opt existing evidence into PO sharing."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings


def test_new_upload_po_sharing_upgrade_and_rollback(tmp_path, monkeypatch):
    database_path = tmp_path / "new-upload-sharing.sqlite"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database_path.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    command.upgrade(config, "f3a4b5c6d7e8")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO procurement_documents "
            "(po_number, procurement_bundle_id, filename, original_filename, file_size, mime_type, category) "
            "VALUES ('PO-OLD', 'old-bundle', 'old/path.pdf', 'old.pdf', 10, 'application/pdf', 'quote')"
        ))
    engine.dispose()

    command.upgrade(config, "c912ee470a63")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT po_number, procurement_bundle_id, filename, shared_po_number FROM procurement_documents"
        )).one()
        assert tuple(row) == ("PO-OLD", "old-bundle", "old/path.pdf", None)
        assert "ix_procurement_documents_shared_po_number" in {
            index["name"] for index in inspect(connection).get_indexes("procurement_documents")
        }
    engine.dispose()

    command.downgrade(config, "f3a4b5c6d7e8")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        assert "shared_po_number" not in {
            column["name"] for column in inspect(connection).get_columns("procurement_documents")
        }
        assert connection.scalar(text("SELECT filename FROM procurement_documents")) == "old/path.pdf"
    engine.dispose()

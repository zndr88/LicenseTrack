"""The PO key migration fills the new columns from the existing PO numbers."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.config import settings
from app.services.procurement_identity import normalize_po_number

_PREVIOUS = "7c3e9a41b2d5"


def _insert(connection, table: str, **values) -> int:
    """Insert one row, filling every other NOT NULL column without a default."""
    row = dict(values)
    for column in connection.execute(text(f"PRAGMA table_info({table})")).mappings():
        name = column["name"]
        if name in row or column["pk"] or not column["notnull"] or column["dflt_value"] is not None:
            continue
        kind = (column["type"] or "").upper()
        row[name] = 0 if ("INT" in kind or "BOOL" in kind) else ""
    names = ", ".join(row)
    params = ", ".join(f":{name}" for name in row)
    result = connection.execute(text(f"INSERT INTO {table} ({names}) VALUES ({params})"), row)
    return result.lastrowid


def test_po_key_backfill_and_downgrade(tmp_path, monkeypatch):
    database = tmp_path / "po-key.sqlite"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    command.upgrade(config, _PREVIOUS)

    engine = create_engine(f"sqlite:///{database.as_posix()}")
    with engine.begin() as connection:
        spaced = _insert(connection, "licenses", publisher_name="P", software_description="a", po_number="  PO   Straße 7 ")
        empty = _insert(connection, "licenses", publisher_name="P", software_description="b", po_number="")
        greek = _insert(connection, "licenses", publisher_name="P", software_description="c", po_number="ΣΊΣΥΦΟΣ")
        shared = _insert(connection, "procurement_documents", shared_po_number="po STRASSE 7")
        unshared = _insert(connection, "procurement_documents", license_id=spaced)

    command.upgrade(config, "head")

    with engine.begin() as connection:
        keys = dict(connection.execute(text("SELECT id, po_key FROM licenses")).all())
        assert keys == {spaced: "po strasse 7", empty: "", greek: normalize_po_number("ΣΊΣΥΦΟΣ")}
        document_keys = dict(connection.execute(text("SELECT id, shared_po_key FROM procurement_documents")).all())
        assert document_keys == {shared: "po strasse 7", unshared: None}

    command.downgrade(config, _PREVIOUS)

    with engine.begin() as connection:
        license_columns = {row["name"] for row in connection.execute(text("PRAGMA table_info(licenses)")).mappings()}
        assert "po_key" not in license_columns
        assert connection.execute(text("SELECT count(*) FROM licenses")).scalar_one() == 3
    engine.dispose()

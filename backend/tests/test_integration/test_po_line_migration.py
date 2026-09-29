"""The PO line register migration backfills existing records once, per the design rules."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.config import settings

_PREVIOUS = "a7c3e91b5d24"


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


def _line(connection, table: str, record_id: int):
    return connection.execute(
        text(
            f"SELECT r.line_number, r.po_key, r.id FROM {table} t "
            "JOIN po_line_register r ON r.id = t.po_line_id WHERE t.id = :id"
        ),
        {"id": record_id},
    ).one_or_none()


def test_backfill_numbers_records_per_po_and_shares_converted_lines(tmp_path, monkeypatch):
    database = tmp_path / "po-lines.sqlite"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    command.upgrade(config, _PREVIOUS)

    engine = create_engine(f"sqlite:///{database.as_posix()}")
    with engine.begin() as connection:
        order = _insert(connection, "pending_orders", po_number="PO 100", supplier="Supplier")
        item1 = _insert(
            connection, "sourcing_items", pending_order_id=order, publisher_name="P",
            software_description="one", created_at="2026-01-01 10:00:00", status="converted",
        )
        item2 = _insert(
            connection, "sourcing_items", pending_order_id=order, publisher_name="P",
            software_description="two", created_at="2026-01-03 10:00:00", status="converted",
        )
        manual = _insert(
            connection, "licenses", publisher_name="P", software_description="manual",
            po_number="po  100", created_at="2026-01-02 10:00:00",
        )
        converted = _insert(
            connection, "licenses", publisher_name="P", software_description="converted",
            po_number="po  100", source_sourcing_item_id=item1, created_at="2026-01-04 10:00:00",
        )
        other = _insert(
            connection, "licenses", publisher_name="P", software_description="other",
            po_number="PO-200", created_at="2026-01-05 10:00:00",
        )
        no_po = _insert(connection, "licenses", publisher_name="P", software_description="none")

    command.upgrade(config, "head")

    with engine.connect() as connection:
        assert _line(connection, "sourcing_items", item1).line_number == 1
        assert _line(connection, "licenses", manual).line_number == 2
        assert _line(connection, "sourcing_items", item2).line_number == 3
        assert _line(connection, "licenses", converted).id == _line(connection, "sourcing_items", item1).id
        assert _line(connection, "licenses", other).line_number == 1
        assert _line(connection, "licenses", other).po_key == "po-200"
        assert _line(connection, "licenses", no_po) is None
        assert connection.scalar(text("SELECT COUNT(*) FROM po_line_register")) == 4

    # Running the backfill again is a no-op.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "po_line_migration", next((Path(config.get_main_option("script_location")) / "versions").glob("*_po_line_register.py"))
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        module._backfill(connection)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM po_line_register")) == 4
    engine.dispose()

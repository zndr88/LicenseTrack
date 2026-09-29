"""po line register

Backfills PO line numbers once for every existing record with a PO number,
per the rules in the 1.2.0 PO line design.

Revision ID: 5f0abf342086
Revises: a7c3e91b5d24
"""

import logging
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

revision = "5f0abf342086"
down_revision = "a7c3e91b5d24"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def _po_key(value):
    # Frozen copy of app.services.procurement_identity.normalize_po_number
    # (migrations are snapshots and must not import application code).
    return " ".join((value or "").split()).casefold()


def upgrade() -> None:
    op.create_table(
        "po_line_register",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("po_key", sa.String(length=255), nullable=False),
        sa.Column("po_number", sa.String(length=255), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("po_key", "line_number", name="uq_po_line_register_key_line"),
    )
    op.create_index("ix_po_line_register_po_key", "po_line_register", ["po_key"])
    for table in ("licenses", "sourcing_items"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("po_line_id", sa.Integer(), nullable=True))
            batch.create_index(f"ix_{table}_po_line_id", ["po_line_id"])
            batch.create_foreign_key(f"fk_{table}_po_line_id", "po_line_register", ["po_line_id"], ["id"])
    _backfill(op.get_bind())


def _backfill(bind) -> None:
    items = bind.execute(sa.text(
        "SELECT si.id AS id, si.created_at AS created_at, po.po_number AS po_number FROM sourcing_items si "
        "JOIN pending_orders po ON po.id = si.pending_order_id "
        "WHERE si.po_line_id IS NULL AND TRIM(COALESCE(po.po_number, '')) <> ''"
    )).fetchall()
    licenses = bind.execute(sa.text(
        "SELECT id, created_at, po_number, source_sourcing_item_id FROM licenses "
        "WHERE po_line_id IS NULL AND TRIM(COALESCE(po_number, '')) <> ''"
    )).fetchall()
    item_po = {row.id: row.po_number for row in items}

    # One entry per purchase line. A license converted from a line with the
    # same PO shares that line's number instead of getting its own.
    entries = defaultdict(list)  # po_key -> [(created_at, kind_order, id, kind, raw_po)]
    shared = []  # (license_id, item_id)
    for row in items:
        entries[_po_key(row.po_number)].append((row.created_at, 0, row.id, "item", row.po_number))
    for row in licenses:
        source = row.source_sourcing_item_id
        if source in item_po and _po_key(item_po[source]) == _po_key(row.po_number):
            shared.append((row.id, source))
        else:
            entries[_po_key(row.po_number)].append((row.created_at, 1, row.id, "license", row.po_number))

    register = sa.Table(
        "po_line_register",
        sa.MetaData(),
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("po_key", sa.String),
        sa.Column("po_number", sa.String),
        sa.Column("line_number", sa.Integer),
    )
    item_line = {}
    for po_key, rows in entries.items():
        spellings = sorted({raw.strip() for *_rest, raw in rows})
        if len(spellings) > 1:
            log.info(
                "PO line backfill: merged PO numbers that differ only in case or spacing: %s",
                ", ".join(spellings),
            )
        start = bind.execute(
            sa.text("SELECT COALESCE(MAX(line_number), 0) FROM po_line_register WHERE po_key = :key"),
            {"key": po_key},
        ).scalar_one()
        rows.sort(key=lambda entry: (entry[0] is None, str(entry[0] or ""), entry[1], entry[2]))
        for offset, (_created, _order, record_id, kind, raw) in enumerate(rows, start=1):
            result = bind.execute(
                register.insert().values(po_key=po_key, po_number=raw.strip(), line_number=start + offset)
            )
            line_id = result.inserted_primary_key[0]
            table = "sourcing_items" if kind == "item" else "licenses"
            bind.execute(sa.text(f"UPDATE {table} SET po_line_id = :line WHERE id = :id"), {"line": line_id, "id": record_id})
            if kind == "item":
                item_line[record_id] = line_id
    for license_id, item_id in shared:
        bind.execute(
            sa.text("UPDATE licenses SET po_line_id = :line WHERE id = :id"),
            {"line": item_line[item_id], "id": license_id},
        )


def downgrade() -> None:
    for table in ("licenses", "sourcing_items"):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_po_line_id", type_="foreignkey")
            batch.drop_index(f"ix_{table}_po_line_id")
            batch.drop_column("po_line_id")
    op.drop_index("ix_po_line_register_po_key", table_name="po_line_register")
    op.drop_table("po_line_register")

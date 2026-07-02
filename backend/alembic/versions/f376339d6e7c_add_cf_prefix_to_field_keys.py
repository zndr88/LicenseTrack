"""add_cf_prefix_to_field_keys

Revision ID: f376339d6e7c
Revises: cc2adba5a103
Create Date: 2026-04-12 19:31:58.737712

"""
from typing import Sequence, Union

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


# revision identifiers, used by Alembic.
revision: str = 'f376339d6e7c'
down_revision: Union[str, None] = 'cc2adba5a103'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Update custom_field_definitions: prepend cf_ to all
    #    field_key values that don't already start with cf_
    conn.execute(text("""
        UPDATE custom_field_definitions
        SET field_key = 'cf_' || field_key
        WHERE field_key NOT LIKE 'cf_%'
    """))

    # 2. Update import_mappings: for each saved mapping, update
    #    any target value that looks like a custom field key
    #    (i.e. is not a known native field and not "skip") to
    #    add the cf_ prefix if missing.
    #    Since mapping is stored as JSON, we fetch all rows,
    #    update in Python, and write back.
    result = conn.execute(text("SELECT id, mapping FROM import_mappings"))
    rows = result.fetchall()

    native_fields = {
        "publisher_name", "software_description", "start_date",
        "end_date", "contract_number", "po_number", "invoice_number",
        "contact_email", "supplier", "cost_centre", "license_type",
        "license_metric", "quantity", "sku_code", "unit_price",
        "total_po_price", "currency", "notes", "budget_owner_email",
        "external_ref", "skip",
    }

    for row_id, mapping_json in rows:
        if not mapping_json:
            continue
        if isinstance(mapping_json, str):
            mapping = json.loads(mapping_json)
        else:
            mapping = mapping_json  # SQLite may parse JSON automatically

        updated = False
        new_mapping = []
        for entry in mapping:
            target = entry.get("target", "")
            if target and target not in native_fields and \
                    not target.startswith("cf_"):
                entry = {**entry, "target": f"cf_{target}"}
                updated = True
            new_mapping.append(entry)

        if updated:
            conn.execute(
                text("UPDATE import_mappings SET mapping = :m WHERE id = :id"),
                {"m": json.dumps(new_mapping), "id": row_id}
            )


def downgrade() -> None:
    conn = op.get_bind()

    # Remove cf_ prefix from custom_field_definitions
    conn.execute(text("""
        UPDATE custom_field_definitions
        SET field_key = SUBSTR(field_key, 4)
        WHERE field_key LIKE 'cf_%'
    """))

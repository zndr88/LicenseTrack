"""Repair missing and drifted foreign-key relationships.

This is deliberately forward-only.  SQLite constraints are rebuilt with Alembic
batch mode after checking for dangling references; no data is silently changed.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "4d5e6f7a8b9c"
down_revision: Union[str, None] = "3c4d5e6f7a81"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _orphans(bind, table: str, column: str, target: str) -> list[tuple]:
    rows = bind.execute(sa.text(
        f"SELECT child.id, child.{column} FROM {table} AS child "
        f"LEFT JOIN {target} AS parent ON parent.id = child.{column} "
        f"WHERE child.{column} IS NOT NULL AND parent.id IS NULL LIMIT 10"
    )).fetchall()
    return rows


def upgrade() -> None:
    bind = op.get_bind()
    checks = (
        ("licenses", "contract_id", "contracts"),
        ("licenses", "pending_order_id", "pending_orders"),
        ("licenses", "predecessor_id", "licenses"),
        ("procurement_documents", "license_id", "licenses"),
        ("licenses", "parent_license_id", "licenses"),
    )
    for table, column, target in checks:
        orphan_rows = _orphans(bind, table, column, target)
        if orphan_rows:
            raise RuntimeError(
                f"Cannot repair {table}.{column}: dangling references exist, examples={orphan_rows}"
            )

    license_fks = {fk.get("name") for fk in sa.inspect(bind).get_foreign_keys("licenses")}
    license_checks = {check.get("name") for check in sa.inspect(bind).get_check_constraints("licenses")}
    with op.batch_alter_table("licenses", recreate="always") as batch_op:
        for name in ("fk_license_contract", "fk_license_parent", "fk_license_predecessor"):
            if name in license_fks:
                batch_op.drop_constraint(name, type_="foreignkey")
        batch_op.create_foreign_key("fk_license_contract", "contracts", ["contract_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_license_pending_order", "pending_orders", ["pending_order_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_license_predecessor", "licenses", ["predecessor_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_license_parent", "licenses", ["parent_license_id"], ["id"], ondelete="SET NULL")
        if "ck_license_maintenance_has_parent" in license_checks:
            batch_op.drop_constraint("ck_license_maintenance_has_parent", type_="check")
        batch_op.create_check_constraint(
            "ck_license_maintenance_has_parent",
            "(license_type = 'maintenance' AND parent_license_id IS NOT NULL) "
            "OR (license_type != 'maintenance' AND parent_license_id IS NULL) "
            "OR (license_type = 'maintenance' AND parent_license_id IS NULL AND is_retired = 1)",
        )

    with op.batch_alter_table("procurement_documents", recreate="always") as batch_op:
        batch_op.create_foreign_key(
            "fk_procurement_document_license", "licenses", ["license_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    raise RuntimeError("Integrity relationship repair migrations are forward-only")

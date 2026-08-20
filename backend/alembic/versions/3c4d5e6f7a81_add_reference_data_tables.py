"""add canonical reference data tables and backfill legacy names

Revision ID: 3c4d5e6f7a81
Revises: 2b3c4d5e6f70
"""

import re
import unicodedata
from collections import Counter, defaultdict

from alembic import op
import sqlalchemy as sa


revision = "3c4d5e6f7a81"
down_revision = "2b3c4d5e6f70"
branch_labels = None
depends_on = None


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"\s+", " ", value.strip())
    return value.casefold()


def _display_name(values: list[str]) -> str:
    counts = Counter(values)
    return min(
        counts,
        key=lambda value: (-counts[value], value.casefold(), value),
    )


def _collect_values(connection, sources: list[tuple[str, str, str]]) -> dict[str, dict]:
    grouped: dict[str, dict] = defaultdict(lambda: {"values": [], "is_publisher": False, "is_supplier": False})
    for table_name, column_name, role in sources:
        rows = connection.execute(
            sa.text(f"SELECT {column_name} FROM {table_name} WHERE {column_name} IS NOT NULL")
        )
        for (value,) in rows:
            if not isinstance(value, str):
                continue
            normalized = _normalize(value)
            if not normalized:
                continue
            item = grouped[normalized]
            item["values"].append(re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()))
            item[role] = True
    return grouped


def _add_reference_columns() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("publisher_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("supplier_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("cost_centre_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_licenses_publisher_id", ["publisher_id"], unique=False)
        batch_op.create_index("ix_licenses_supplier_id", ["supplier_id"], unique=False)
        batch_op.create_index("ix_licenses_cost_centre_id", ["cost_centre_id"], unique=False)
        batch_op.create_foreign_key("fk_licenses_publisher_id_organizations", "organizations", ["publisher_id"], ["id"])
        batch_op.create_foreign_key("fk_licenses_supplier_id_organizations", "organizations", ["supplier_id"], ["id"])
        batch_op.create_foreign_key("fk_licenses_cost_centre_id_cost_centres", "cost_centres", ["cost_centre_id"], ["id"])

    with op.batch_alter_table("contracts") as batch_op:
        batch_op.add_column(sa.Column("publisher_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_contracts_publisher_id", ["publisher_id"], unique=False)
        batch_op.create_foreign_key("fk_contracts_publisher_id_organizations", "organizations", ["publisher_id"], ["id"])

    with op.batch_alter_table("sourcing_requests") as batch_op:
        batch_op.add_column(sa.Column("supplier_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_sourcing_requests_supplier_id", ["supplier_id"], unique=False)
        batch_op.create_foreign_key("fk_sourcing_requests_supplier_id_organizations", "organizations", ["supplier_id"], ["id"])

    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.add_column(sa.Column("publisher_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("supplier_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_sourcing_items_publisher_id", ["publisher_id"], unique=False)
        batch_op.create_index("ix_sourcing_items_supplier_id", ["supplier_id"], unique=False)
        batch_op.create_foreign_key("fk_sourcing_items_publisher_id_organizations", "organizations", ["publisher_id"], ["id"])
        batch_op.create_foreign_key("fk_sourcing_items_supplier_id_organizations", "organizations", ["supplier_id"], ["id"])

    with op.batch_alter_table("pending_orders") as batch_op:
        batch_op.add_column(sa.Column("supplier_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_pending_orders_supplier_id", ["supplier_id"], unique=False)
        batch_op.create_foreign_key("fk_pending_orders_supplier_id_organizations", "organizations", ["supplier_id"], ["id"])

    with op.batch_alter_table("user_department_access") as batch_op:
        batch_op.add_column(sa.Column("cost_centre_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_user_department_access_cost_centre_id", ["cost_centre_id"], unique=False)
        batch_op.create_foreign_key("fk_user_department_access_cost_centre_id_cost_centres", "cost_centres", ["cost_centre_id"], ["id"])


def _backfill(connection, organizations: dict[str, dict], cost_centres: dict[str, dict]) -> None:
    organization_ids = {}
    for normalized in sorted(organizations):
        item = organizations[normalized]
        result = connection.execute(
            sa.text(
                "INSERT INTO organizations "
                "(name, normalized_name, is_publisher, is_supplier, is_active) "
                "VALUES (:name, :normalized_name, :is_publisher, :is_supplier, 1)"
            ),
            {
                "name": _display_name(item["values"]),
                "normalized_name": normalized,
                "is_publisher": item["is_publisher"],
                "is_supplier": item["is_supplier"],
            },
        )
        organization_ids[normalized] = result.lastrowid

    cost_centre_ids = {}
    for normalized in sorted(cost_centres):
        item = cost_centres[normalized]
        result = connection.execute(
            sa.text(
                "INSERT INTO cost_centres (name, normalized_name, is_active) "
                "VALUES (:name, :normalized_name, 1)"
            ),
            {"name": _display_name(item["values"]), "normalized_name": normalized},
        )
        cost_centre_ids[normalized] = result.lastrowid

    organization_columns = {
        "licenses": [("publisher_name", "publisher_id"), ("supplier", "supplier_id")],
        "contracts": [("publisher_name", "publisher_id")],
        "sourcing_requests": [("supplier", "supplier_id")],
        "sourcing_items": [("publisher_name", "publisher_id"), ("supplier", "supplier_id")],
        "pending_orders": [("supplier", "supplier_id")],
    }
    for table_name, columns in organization_columns.items():
        for name_column, id_column in columns:
            rows = connection.execute(sa.text(f"SELECT id, {name_column} FROM {table_name}"))
            for row_id, value in rows:
                if isinstance(value, str) and _normalize(value) in organization_ids:
                    connection.execute(
                        sa.text(f"UPDATE {table_name} SET {id_column} = :reference_id WHERE id = :row_id"),
                        {"reference_id": organization_ids[_normalize(value)], "row_id": row_id},
                    )

    for table_name, name_column in (("licenses", "cost_centre"), ("user_department_access", "department")):
        rows = connection.execute(sa.text(f"SELECT id, {name_column} FROM {table_name}"))
        for row_id, value in rows:
            if isinstance(value, str) and _normalize(value) in cost_centre_ids:
                connection.execute(
                    sa.text(f"UPDATE {table_name} SET cost_centre_id = :reference_id WHERE id = :row_id"),
                    {"reference_id": cost_centre_ids[_normalize(value)], "row_id": row_id},
                )


def upgrade() -> None:
    connection = op.get_bind()
    organizations = _collect_values(
        connection,
        [
            ("licenses", "publisher_name", "is_publisher"),
            ("contracts", "publisher_name", "is_publisher"),
            ("sourcing_items", "publisher_name", "is_publisher"),
            ("licenses", "supplier", "is_supplier"),
            ("sourcing_requests", "supplier", "is_supplier"),
            ("sourcing_items", "supplier", "is_supplier"),
            ("pending_orders", "supplier", "is_supplier"),
        ],
    )
    cost_centres = _collect_values(
        connection,
        [("licenses", "cost_centre", "unused"), ("user_department_access", "department", "unused")],
    )
    for item in cost_centres.values():
        item.pop("unused", None)

    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("is_publisher", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_supplier", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_organizations_normalized_name", "organizations", ["normalized_name"], unique=True)
    op.create_table(
        "organization_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_organization_aliases_organization_id", "organization_aliases", ["organization_id"])
    op.create_index("ix_organization_aliases_normalized_name", "organization_aliases", ["normalized_name"], unique=True)
    op.create_table(
        "cost_centres",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cost_centres_normalized_name", "cost_centres", ["normalized_name"], unique=True)
    op.create_table(
        "cost_centre_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cost_centre_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["cost_centre_id"], ["cost_centres.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_cost_centre_aliases_cost_centre_id", "cost_centre_aliases", ["cost_centre_id"])
    op.create_index("ix_cost_centre_aliases_normalized_name", "cost_centre_aliases", ["normalized_name"], unique=True)

    _add_reference_columns()
    _backfill(connection, organizations, cost_centres)


def downgrade() -> None:
    for table_name, constraints in {
        "user_department_access": [("fk_user_department_access_cost_centre_id_cost_centres", "cost_centre_id")],
        "pending_orders": [("fk_pending_orders_supplier_id_organizations", "supplier_id")],
        "sourcing_items": [
            ("fk_sourcing_items_supplier_id_organizations", "supplier_id"),
            ("fk_sourcing_items_publisher_id_organizations", "publisher_id"),
        ],
        "sourcing_requests": [("fk_sourcing_requests_supplier_id_organizations", "supplier_id")],
        "contracts": [("fk_contracts_publisher_id_organizations", "publisher_id")],
        "licenses": [
            ("fk_licenses_cost_centre_id_cost_centres", "cost_centre_id"),
            ("fk_licenses_supplier_id_organizations", "supplier_id"),
            ("fk_licenses_publisher_id_organizations", "publisher_id"),
        ],
    }.items():
        with op.batch_alter_table(table_name) as batch_op:
            for constraint_name, column_name in constraints:
                batch_op.drop_constraint(constraint_name, type_="foreignkey")
                batch_op.drop_index(f"ix_{table_name}_{column_name}")
                batch_op.drop_column(column_name)

    op.drop_index("ix_cost_centre_aliases_normalized_name", table_name="cost_centre_aliases")
    op.drop_index("ix_cost_centre_aliases_cost_centre_id", table_name="cost_centre_aliases")
    op.drop_table("cost_centre_aliases")
    op.drop_index("ix_organization_aliases_normalized_name", table_name="organization_aliases")
    op.drop_index("ix_organization_aliases_organization_id", table_name="organization_aliases")
    op.drop_table("organization_aliases")
    op.drop_index("ix_cost_centres_normalized_name", table_name="cost_centres")
    op.drop_table("cost_centres")
    op.drop_index("ix_organizations_normalized_name", table_name="organizations")
    op.drop_table("organizations")

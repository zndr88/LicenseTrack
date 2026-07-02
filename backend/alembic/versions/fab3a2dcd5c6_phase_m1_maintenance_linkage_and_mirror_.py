"""phase_m1_maintenance_linkage_and_mirror_fields

Revision ID: fab3a2dcd5c6
Revises: 757485dbe08a
Create Date: 2026-04-24 14:57:46.975645

"""

from alembic import op
import sqlalchemy as sa


revision = "fab3a2dcd5c6"
down_revision = "757485dbe08a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {
        column["name"] for column in inspector.get_columns("licenses")
    }
    existing_indexes = {
        index["name"] for index in inspector.get_indexes("licenses")
    }

    # Step A -- Add the four mirror columns and two FKs to licenses.
    # All nullable with safe defaults so existing rows satisfy
    # the CHECK constraints we add in Step B.
    if "has_maintenance" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column(
                "has_maintenance",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
    if "maintenance_start_date" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column("maintenance_start_date", sa.Date(), nullable=True),
        )
    if "maintenance_end_date" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column("maintenance_end_date", sa.Date(), nullable=True),
        )
    if "maintenance_cost" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column("maintenance_cost", sa.String(length=50), nullable=True),
        )
    if "parent_license_id" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column("parent_license_id", sa.Integer(), nullable=True),
        )
    if "active_maintenance_id" not in existing_columns:
        op.add_column(
            "licenses",
            sa.Column("active_maintenance_id", sa.Integer(), nullable=True),
        )

    # Index on parent_license_id (FK column) for efficient
    # "list all children of license X" queries
    if "ix_licenses_parent_license_id" not in existing_indexes:
        op.create_index(
            "ix_licenses_parent_license_id",
            "licenses",
            ["parent_license_id"],
        )

    # Step B -- Add FK constraints and CHECK constraints via batch.
    #
    # SQLite cannot ALTER constraints in place -- batch mode
    # rebuilds the table with the new constraints. The FKs
    # use use_alter=True equivalent (named constraints that can
    # be resolved after the table is rebuilt).
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.create_foreign_key(
            "fk_license_parent",
            "licenses",
            ["parent_license_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_license_active_maintenance",
            "licenses",
            ["active_maintenance_id"],
            ["id"],
        )
        batch_op.create_check_constraint(
            "ck_license_perpetual_no_end_date",
            "NOT (license_type = 'perpetual' AND end_date IS NOT NULL)",
        )
        batch_op.create_check_constraint(
            "ck_license_maintenance_has_parent",
            "(license_type = 'maintenance' AND parent_license_id IS NOT NULL) "
            "OR (license_type != 'maintenance' AND parent_license_id IS NULL)",
        )
        batch_op.create_check_constraint(
            "ck_license_maintenance_link_consistency",
            "(has_maintenance = 1 AND active_maintenance_id IS NOT NULL) "
            "OR (has_maintenance = 0 AND active_maintenance_id IS NULL)",
        )


def downgrade() -> None:
    # Drop everything added by upgrade. Constraints first via
    # batch, then columns.
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_constraint(
            "ck_license_maintenance_link_consistency", type_="check"
        )
        batch_op.drop_constraint(
            "ck_license_maintenance_has_parent", type_="check"
        )
        batch_op.drop_constraint(
            "ck_license_perpetual_no_end_date", type_="check"
        )
        batch_op.drop_constraint(
            "fk_license_active_maintenance", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "fk_license_parent", type_="foreignkey"
        )

    op.drop_index("ix_licenses_parent_license_id", table_name="licenses")
    op.drop_column("licenses", "active_maintenance_id")
    op.drop_column("licenses", "parent_license_id")
    op.drop_column("licenses", "maintenance_cost")
    op.drop_column("licenses", "maintenance_end_date")
    op.drop_column("licenses", "maintenance_start_date")
    op.drop_column("licenses", "has_maintenance")

"""add explicit legacy-unlinked maintenance state

Revision ID: 6f7a8b9c0d1e
Revises: 5e6f7a8b9c0d
"""

from alembic import op
import sqlalchemy as sa


revision = "6f7a8b9c0d1e"
down_revision = "5e6f7a8b9c0d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    invalid = bind.execute(
        sa.text(
            "SELECT id FROM licenses "
            "WHERE license_type = 'maintenance' "
            "AND parent_license_id IS NULL AND is_retired = 0"
        )
    ).fetchall()
    if invalid:
        raise RuntimeError(
            "Cannot add legacy-unlinked maintenance state: active parentless "
            f"maintenance rows already exist ({[row[0] for row in invalid]!r})"
        )

    with op.batch_alter_table("licenses", recreate="always") as batch_op:
        batch_op.add_column(
            sa.Column("is_legacy_unlinked_maintenance", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )
        batch_op.drop_constraint("ck_license_maintenance_has_parent", type_="check")
        batch_op.create_check_constraint(
            "ck_license_maintenance_has_parent",
            "(license_type = 'maintenance' AND parent_license_id IS NOT NULL "
            "AND is_legacy_unlinked_maintenance = 0) "
            "OR (license_type = 'maintenance' AND parent_license_id IS NULL "
            "AND (is_legacy_unlinked_maintenance = 1 OR is_retired = 1)) "
            "OR (license_type != 'maintenance' AND parent_license_id IS NULL "
            "AND is_legacy_unlinked_maintenance = 0)",
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_license_maintenance_has_parent", type_="check")
        batch_op.create_check_constraint(
            "ck_license_maintenance_has_parent",
            "(license_type = 'maintenance' AND parent_license_id IS NOT NULL) "
            "OR (license_type != 'maintenance' AND parent_license_id IS NULL) "
            "OR (license_type = 'maintenance' AND parent_license_id IS NULL AND is_retired = 1)",
        )
        batch_op.drop_column("is_legacy_unlinked_maintenance")

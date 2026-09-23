"""Let a maintenance sourcing line carry the license it supports.

Existing lines get NULL; conversion keeps asking for a parent as before.
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c1"
down_revision = "c4d5e6f7a8b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch:
        batch.add_column(sa.Column("maintenance_parent_license_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_sourcing_items_maintenance_parent_license_id",
            "licenses",
            ["maintenance_parent_license_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_sourcing_items_maintenance_parent_license_id", ["maintenance_parent_license_id"])


def downgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch:
        batch.drop_index("ix_sourcing_items_maintenance_parent_license_id")
        batch.drop_constraint("fk_sourcing_items_maintenance_parent_license_id", type_="foreignkey")
        batch.drop_column("maintenance_parent_license_id")

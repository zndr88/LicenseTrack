"""Store planned successor links between sourcing lines."""

from alembic import op
import sqlalchemy as sa


revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch:
        batch.add_column(sa.Column("successor_sourcing_item_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_sourcing_items_successor_sourcing_item_id",
            "sourcing_items",
            ["successor_sourcing_item_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_sourcing_items_successor_sourcing_item_id", ["successor_sourcing_item_id"])


def downgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch:
        batch.drop_index("ix_sourcing_items_successor_sourcing_item_id")
        batch.drop_constraint("fk_sourcing_items_successor_sourcing_item_id", type_="foreignkey")
        batch.drop_column("successor_sourcing_item_id")

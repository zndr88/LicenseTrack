"""Preserve category and selected draft line for newly staged evidence."""

from alembic import op
import sqlalchemy as sa

revision = "d823fa681b94"
down_revision = "c912ee470a63"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sourcing_quote_documents", sa.Column("category", sa.String(30), nullable=False, server_default="quote")
    )
    op.add_column(
        "sourcing_quote_documents", sa.Column("shared_upload", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    for table in ("sourcing_quote_documents", "procurement_documents"):
        op.add_column(table, sa.Column("target_sourcing_item_id", sa.Integer(), nullable=True))
        op.create_index(f"ix_{table}_target_sourcing_item_id", table, ["target_sourcing_item_id"])


def downgrade():
    for table in ("procurement_documents", "sourcing_quote_documents"):
        op.drop_index(f"ix_{table}_target_sourcing_item_id", table_name=table)
        op.drop_column(table, "target_sourcing_item_id")
    op.drop_column("sourcing_quote_documents", "shared_upload")
    op.drop_column("sourcing_quote_documents", "category")

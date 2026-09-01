"""stage license fields and custom values

Revision ID: b7e4c2a19d6f
Revises: 9f2c4e6a8b1d
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e4c2a19d6f"
down_revision: str | None = "9f2c4e6a8b1d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.add_column(
            sa.Column("carry_forward_on_renewal", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )

    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.add_column(sa.Column("license_metric", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("portal_url", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("quantity_per_unit", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("sku_code", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("notice_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("purchase_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("contract_number", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("invoice_number", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("external_ref", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("cost_centre", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("budget_owner_email", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("secondary_contacts", sa.JSON(), nullable=False, server_default="[]"))

    op.create_table(
        "sourcing_item_custom_values",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("sourcing_item_id", sa.Integer(), nullable=False),
        sa.Column("custom_field_def_id", sa.Integer(), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_currency", sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(["custom_field_def_id"], ["custom_field_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sourcing_item_id"], ["sourcing_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sourcing_item_id", "custom_field_def_id", name="uq_sourcing_item_custom_field"),
    )
    op.create_index(
        "ix_sourcing_item_custom_values_sourcing_item_id",
        "sourcing_item_custom_values",
        ["sourcing_item_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_sourcing_item_custom_values_sourcing_item_id", table_name="sourcing_item_custom_values")
    op.drop_table("sourcing_item_custom_values")
    with op.batch_alter_table("sourcing_items") as batch_op:
        for column in (
            "secondary_contacts", "budget_owner_email", "cost_centre", "external_ref", "invoice_number",
            "contract_number", "purchase_date", "notice_date", "sku_code", "quantity_per_unit", "portal_url",
            "license_metric",
        ):
            batch_op.drop_column(column)
    with op.batch_alter_table("custom_field_definitions") as batch_op:
        batch_op.drop_column("carry_forward_on_renewal")

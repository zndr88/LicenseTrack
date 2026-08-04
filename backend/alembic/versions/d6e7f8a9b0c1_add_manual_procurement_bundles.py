"""add manual procurement bundles

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-04 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("procurement_bundle_id", sa.String(length=36), nullable=True))
        batch_op.create_index("ix_licenses_procurement_bundle_id", ["procurement_bundle_id"], unique=False)

    with op.batch_alter_table("procurement_documents") as batch_op:
        batch_op.add_column(sa.Column("procurement_bundle_id", sa.String(length=36), nullable=True))
        batch_op.create_index(
            "ix_procurement_documents_procurement_bundle_id",
            ["procurement_bundle_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("procurement_documents") as batch_op:
        batch_op.drop_index("ix_procurement_documents_procurement_bundle_id")
        batch_op.drop_column("procurement_bundle_id")

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_index("ix_licenses_procurement_bundle_id")
        batch_op.drop_column("procurement_bundle_id")

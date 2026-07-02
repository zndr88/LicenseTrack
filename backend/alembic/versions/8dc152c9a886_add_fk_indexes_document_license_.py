"""add_fk_indexes_document_license_sourcing_renewal

Revision ID: 8dc152c9a886
Revises: a1b2c3d4e5f6
Create Date: 2026-03-21 20:55:57.044270

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8dc152c9a886'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_documents_license_id", "documents", ["license_id"], if_not_exists=True)
    op.create_index(
        "ix_sourcing_items_renewal_for_license_id",
        "sourcing_items",
        ["renewal_for_license_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_sourcing_items_renewal_for_license_id", "sourcing_items", if_exists=True)
    op.drop_index("ix_documents_license_id", "documents", if_exists=True)

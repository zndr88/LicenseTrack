"""add sourcing item license type

Revision ID: 8c9d0e1f2a3b
Revises: 7b8c9d0e1f2a
Create Date: 2026-07-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "8c9d0e1f2a3b"
down_revision: Union[str, None] = "7b8c9d0e1f2a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    license_type = sa.Enum(
        "subscription",
        "perpetual",
        "maintenance",
        "saas",
        "oem",
        "freeware",
        name="licensetype",
    )
    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.add_column(sa.Column("license_type", license_type, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.drop_column("license_type")

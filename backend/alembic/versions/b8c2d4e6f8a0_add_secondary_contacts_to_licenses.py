"""add secondary contacts to licenses

Revision ID: b8c2d4e6f8a0
Revises: e7f8a9b0c1d2
Create Date: 2026-08-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c2d4e6f8a0"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("secondary_contacts", sa.JSON(), nullable=True))

    licenses = sa.table(
        "licenses",
        sa.column("id", sa.Integer),
        sa.column("secondary_contacts", sa.JSON),
    )
    bind = op.get_bind()
    bind.execute(licenses.update().values(secondary_contacts=[]))

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.alter_column("secondary_contacts", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("secondary_contacts")

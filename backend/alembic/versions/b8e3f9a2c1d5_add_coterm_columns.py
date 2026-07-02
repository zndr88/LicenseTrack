"""add_coterm_columns

Revision ID: b8e3f9a2c1d5
Revises: f1e2994e3093
Create Date: 2026-03-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e3f9a2c1d5'
down_revision: Union[str, None] = 'f1e2994e3093'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sourcing_items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('coterm_predecessor_ids', sa.JSON(), nullable=True))

    with op.batch_alter_table('licenses', schema=None) as batch_op:
        batch_op.add_column(sa.Column('coterm_from_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('licenses', schema=None) as batch_op:
        batch_op.drop_column('coterm_from_ids')

    with op.batch_alter_table('sourcing_items', schema=None) as batch_op:
        batch_op.drop_column('coterm_predecessor_ids')

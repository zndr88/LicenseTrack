"""remove require_mfa from global_settings

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('global_settings', schema=None) as batch_op:
        batch_op.drop_column('require_mfa')


def downgrade() -> None:
    with op.batch_alter_table('global_settings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('require_mfa', sa.Boolean(), nullable=False, server_default='1'))

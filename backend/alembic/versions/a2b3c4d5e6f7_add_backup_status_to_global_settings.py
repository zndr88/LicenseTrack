"""add backup status fields to global_settings

Revision ID: a2b3c4d5e6f7
Revises: 0c5d7e9a1b2c
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = '0c5d7e9a1b2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('global_settings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_backup_status', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('last_backup_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('global_settings', schema=None) as batch_op:
        batch_op.drop_column('last_backup_at')
        batch_op.drop_column('last_backup_status')

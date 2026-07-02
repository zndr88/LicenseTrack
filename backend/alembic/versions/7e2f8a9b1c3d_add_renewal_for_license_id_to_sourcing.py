"""add_renewal_for_license_id_to_sourcing_items

Revision ID: 7e2f8a9b1c3d
Revises: f526effc8ebf
Create Date: 2026-03-03 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e2f8a9b1c3d'
down_revision: Union[str, None] = 'f526effc8ebf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sourcing_items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('renewal_for_license_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_sourcing_items_renewal_for_license_id',
            'licenses',
            ['renewal_for_license_id'],
            ['id'],
        )


def downgrade() -> None:
    with op.batch_alter_table('sourcing_items', schema=None) as batch_op:
        batch_op.drop_constraint('fk_sourcing_items_renewal_for_license_id', type_='foreignkey')
        batch_op.drop_column('renewal_for_license_id')

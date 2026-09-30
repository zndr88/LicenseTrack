"""user setting: show portfolio overview

Revision ID: 2ce70b265de2
Revises: 5f0abf342086
Create Date: 2026-09-30 02:55:39.419042

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2ce70b265de2'
down_revision: Union[str, None] = '5f0abf342086'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.add_column(sa.Column("show_portfolio_overview", sa.Boolean(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch_op:
        batch_op.drop_column("show_portfolio_overview")

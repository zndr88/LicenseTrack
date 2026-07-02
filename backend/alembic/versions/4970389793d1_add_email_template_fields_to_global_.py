"""add email template fields to global_settings

Revision ID: 4970389793d1
Revises: 5379967bd20c
Create Date: 2026-03-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4970389793d1"
down_revision: Union[str, None] = "5379967bd20c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("email_template_budget_owner_intro", sa.Text(), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("email_template_budget_owner_signoff", sa.Text(), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("email_template_manager_intro", sa.Text(), nullable=False, server_default="")
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.drop_column("email_template_manager_intro")
        batch_op.drop_column("email_template_budget_owner_signoff")
        batch_op.drop_column("email_template_budget_owner_intro")


"""add renewal workbench columns to user_settings

Revision ID: 0c5d7e9a1b2c
Revises: fab3a2dcd5c6
Create Date: 2026-04-30 09:35:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "0c5d7e9a1b2c"
down_revision = "fab3a2dcd5c6"
branch_labels = None
depends_on = None


DEFAULT_COLUMNS = (
    '{"dueDate": true, "days": true, "license": true, "licenseRef": true, '
    '"supplier": true, "budgetOwner": true, "value": true, "status": true, '
    '"riskFlags": true, "actions": true}'
)


def upgrade() -> None:
    with op.batch_alter_table("user_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "renewal_workbench_columns",
                sa.JSON(),
                nullable=False,
                server_default=DEFAULT_COLUMNS,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("user_settings", schema=None) as batch_op:
        batch_op.drop_column("renewal_workbench_columns")

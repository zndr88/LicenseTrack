"""Add an independent renewal action eligibility window."""

from alembic import op
import sqlalchemy as sa

revision = "a21b3c4d5e6f"
down_revision = "d823fa681b94"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("global_settings", sa.Column("renewal_action_days", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("global_settings", "renewal_action_days")

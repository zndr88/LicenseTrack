"""Preserve maintenance relationship state for existing-successor undo."""
from alembic import op
import sqlalchemy as sa

revision = "d2b3c4d5e6f7"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("licenses", sa.Column("existing_successor_maintenance_state", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_column("existing_successor_maintenance_state")

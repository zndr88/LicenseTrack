"""Add a public base URL used for license links in notification emails.

Empty for existing installs, which keeps emails without links (current behavior).
"""

from alembic import op
import sqlalchemy as sa


revision = "c4d5e6f7a8b0"
down_revision = "b2c3d4e5f6a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch:
        batch.add_column(sa.Column("public_base_url", sa.String(length=500), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch:
        batch.drop_column("public_base_url")

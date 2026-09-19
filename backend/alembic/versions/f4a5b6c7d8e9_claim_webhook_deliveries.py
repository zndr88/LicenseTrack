"""Add durable claims for webhook delivery workers.

Revision ID: f4a5b6c7d8e9
Revises: e3c4d5e6f7a8
"""

from alembic import op
import sqlalchemy as sa

revision = "f4a5b6c7d8e9"
down_revision = "e3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("webhook_deliveries", sa.Column("claim_token", sa.String(length=64), nullable=True))
    op.add_column("webhook_deliveries", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_webhook_deliveries_status_claimed_at", "webhook_deliveries", ["status", "claimed_at"])


def downgrade():
    op.drop_index("ix_webhook_deliveries_status_claimed_at", table_name="webhook_deliveries")
    with op.batch_alter_table("webhook_deliveries") as batch_op:
        batch_op.drop_column("claimed_at")
        batch_op.drop_column("claim_token")

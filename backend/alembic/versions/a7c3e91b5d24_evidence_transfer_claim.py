"""Add an evidence-transfer claim (token and time) to pending orders.

Revision ID: a7c3e91b5d24
Revises: e6f7a8b9c0d2
"""

import sqlalchemy as sa
from alembic import op

revision = "a7c3e91b5d24"
down_revision = "e6f7a8b9c0d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch:
        batch.add_column(sa.Column("evidence_transfer_claim_token", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("evidence_transfer_claimed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pending_orders") as batch:
        batch.drop_column("evidence_transfer_claimed_at")
        batch.drop_column("evidence_transfer_claim_token")

"""add webhooks

Revision ID: cd34ef56ab12
Revises: ab12cd34ef56
Create Date: 2026-05-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "cd34ef56ab12"
down_revision: Union[str, None] = "ab12cd34ef56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("events", sa.String(length=1000), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_webhook_endpoints_created_by"), "webhook_endpoints", ["created_by"], unique=False)
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("endpoint_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=150), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["endpoint_id"], ["webhook_endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_webhook_deliveries_endpoint_id"), "webhook_deliveries", ["endpoint_id"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_status"), "webhook_deliveries", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_webhook_deliveries_status"), table_name="webhook_deliveries")
    op.drop_index(op.f("ix_webhook_deliveries_endpoint_id"), table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_index(op.f("ix_webhook_endpoints_created_by"), table_name="webhook_endpoints")
    op.drop_table("webhook_endpoints")

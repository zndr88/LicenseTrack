"""add api tokens

Revision ID: ab12cd34ef56
Revises: b2c3d4e5f6a7
Create Date: 2026-05-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ab12cd34ef56"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("scopes", sa.String(length=500), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_api_tokens_created_by"), "api_tokens", ["created_by"], unique=False)
    op.create_index(op.f("ix_api_tokens_token_hash"), "api_tokens", ["token_hash"], unique=False)
    op.create_index(op.f("ix_api_tokens_token_prefix"), "api_tokens", ["token_prefix"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_api_tokens_token_prefix"), table_name="api_tokens")
    op.drop_index(op.f("ix_api_tokens_token_hash"), table_name="api_tokens")
    op.drop_index(op.f("ix_api_tokens_created_by"), table_name="api_tokens")
    op.drop_table("api_tokens")

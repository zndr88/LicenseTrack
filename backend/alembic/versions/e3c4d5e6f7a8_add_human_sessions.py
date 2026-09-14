"""Add individually revocable browser sessions.

Revision ID: e3c4d5e6f7a8
Revises: d2b3c4d5e6f7
"""

from alembic import op
import sqlalchemy as sa

revision = "e3c4d5e6f7a8"
down_revision = "d2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "human_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("security_version", sa.Integer(), nullable=False),
        sa.Column("issued_at", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_human_sessions_user_id", "human_sessions", ["user_id"])
    op.create_index("ix_human_sessions_expires_at", "human_sessions", ["expires_at"])


def downgrade():
    op.drop_table("human_sessions")

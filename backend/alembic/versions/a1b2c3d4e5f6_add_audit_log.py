"""add audit log table and retention setting

Revision ID: a1b2c3d4e5f6
Revises: 57b9d47c76b6
Create Date: 2026-03-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '57b9d47c76b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("actor_email", sa.String(), nullable=False),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=True),
        sa.Column("target_id", sa.String(), nullable=True),
        sa.Column("target_label", sa.String(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_timestamp", "audit_log", ["timestamp"])

    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("audit_log_retention_days", sa.Integer(), nullable=False, server_default="90")
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.drop_column("audit_log_retention_days")

    op.drop_index("ix_audit_log_timestamp", table_name="audit_log")
    op.drop_table("audit_log")

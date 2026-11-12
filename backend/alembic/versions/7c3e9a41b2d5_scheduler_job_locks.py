"""scheduler job locks

Adds the table that records which copy of the app is currently running a
scheduled job, so a job that must not run twice runs in only one copy when
several copies share the database. One row per job name.

Revision ID: 7c3e9a41b2d5
Revises: ed0290d95ac3
Create Date: 2026-11-12 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c3e9a41b2d5'
down_revision: Union[str, None] = 'ed0290d95ac3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scheduler_job_locks",
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("scheduler_job_locks")

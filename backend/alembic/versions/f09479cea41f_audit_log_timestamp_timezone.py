"""audit_log_timestamp_timezone

Revision ID: f09479cea41f
Revises: 979dee1bb0f0
Create Date: 2026-04-07 13:31:26.921960

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f09479cea41f'
down_revision: Union[str, None] = '979dee1bb0f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite stores all datetimes as strings without timezone info.
    # This migration is a no-op for SQLite but documents the intent
    # to use timezone-aware datetimes throughout the codebase.
    # The AuditLog.timestamp column now uses DateTime(timezone=True)
    # and default=lambda: datetime.now(timezone.utc) in the ORM model.
    pass


def downgrade() -> None:
    pass

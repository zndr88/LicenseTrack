"""add existing successor link provenance

Revision ID: 7a8b9c0d1e2f
Revises: 6f7a8b9c0d1e
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7a8b9c0d1e2f"
down_revision: str | None = "6f7a8b9c0d1e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("licenses", sa.Column("existing_successor_linked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("licenses", sa.Column("existing_successor_linked_by_email", sa.String(length=255), nullable=True))
    op.add_column("licenses", sa.Column("existing_successor_original_ref", sa.String(length=20), nullable=True))
    op.add_column(
        "licenses",
        sa.Column("license_ref_aliases", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("licenses", "license_ref_aliases")
    op.drop_column("licenses", "existing_successor_original_ref")
    op.drop_column("licenses", "existing_successor_linked_by_email")
    op.drop_column("licenses", "existing_successor_linked_at")

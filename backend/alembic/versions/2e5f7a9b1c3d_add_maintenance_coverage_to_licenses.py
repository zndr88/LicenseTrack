"""add maintenance coverage classification to licenses

Revision ID: 2e5f7a9b1c3d
Revises: 1d4e6f8a9b0c
Create Date: 2026-06-02 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "2e5f7a9b1c3d"
down_revision = "1d4e6f8a9b0c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "licenses",
        sa.Column(
            "maintenance_coverage",
            sa.String(length=18),
            nullable=False,
            server_default="unknown",
        ),
    )
    op.execute(
        """
        UPDATE licenses
        SET maintenance_coverage = CASE
            WHEN license_type = 'maintenance' THEN 'not_applicable'
            WHEN has_maintenance = 1 OR active_maintenance_id IS NOT NULL THEN 'separately_tracked'
            WHEN license_type IN ('subscription', 'saas') THEN 'included'
            ELSE 'unknown'
        END
        """
    )


def downgrade() -> None:
    op.drop_column("licenses", "maintenance_coverage")

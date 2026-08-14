"""add license maintenance links

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "license_maintenance_links",
        sa.Column("maintenance_license_id", sa.Integer(), nullable=False),
        sa.Column("parent_license_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "maintenance_license_id != parent_license_id",
            name="ck_license_maintenance_link_not_self",
        ),
        sa.ForeignKeyConstraint(
            ["maintenance_license_id"],
            ["licenses.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_license_id"],
            ["licenses.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("maintenance_license_id", "parent_license_id"),
    )
    op.create_index(
        "ix_license_maintenance_links_parent_license_id",
        "license_maintenance_links",
        ["parent_license_id"],
    )

    licenses = sa.table(
        "licenses",
        sa.column("id", sa.Integer),
        sa.column("license_type", sa.String),
        sa.column("parent_license_id", sa.Integer),
    )
    links = sa.table(
        "license_maintenance_links",
        sa.column("maintenance_license_id", sa.Integer),
        sa.column("parent_license_id", sa.Integer),
    )
    bind = op.get_bind()
    bind.execute(
        links.insert().from_select(
            ["maintenance_license_id", "parent_license_id"],
            sa.select(licenses.c.id, licenses.c.parent_license_id).where(
                licenses.c.license_type == "maintenance",
                licenses.c.parent_license_id.is_not(None),
            ),
        )
    )


def downgrade() -> None:
    op.drop_index("ix_license_maintenance_links_parent_license_id", table_name="license_maintenance_links")
    op.drop_table("license_maintenance_links")

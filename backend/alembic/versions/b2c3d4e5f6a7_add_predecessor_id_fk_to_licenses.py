"""add_predecessor_id_fk_to_licenses

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f7
Create Date: 2026-05-21 10:30:00.000000

"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    license_columns = {column["name"] for column in inspector.get_columns("licenses")}
    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}

    if "predecessor_id" not in license_columns:
        op.add_column("licenses", sa.Column("predecessor_id", sa.Integer(), nullable=True))
    if "ix_licenses_predecessor_id" not in license_indexes:
        op.create_index("ix_licenses_predecessor_id", "licenses", ["predecessor_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}
    license_columns = {column["name"] for column in inspector.get_columns("licenses")}

    if "ix_licenses_predecessor_id" in license_indexes:
        op.drop_index("ix_licenses_predecessor_id", table_name="licenses")
    if "predecessor_id" in license_columns:
        op.drop_column("licenses", "predecessor_id")

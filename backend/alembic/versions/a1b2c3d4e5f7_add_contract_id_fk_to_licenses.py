"""add_contract_id_fk_to_licenses

Revision ID: a1b2c3d4e5f7
Revises: e1f2a3b4c5d6
Create Date: 2026-05-21 10:00:00.000000

"""

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    license_columns = {column["name"] for column in inspector.get_columns("licenses")}
    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}

    if "contract_id" not in license_columns:
        op.add_column("licenses", sa.Column("contract_id", sa.Integer(), nullable=True))
    if "ix_licenses_contract_id" not in license_indexes:
        op.create_index("ix_licenses_contract_id", "licenses", ["contract_id"])

    # Backfill contract_id by matching license.contract_number to contract.contract_number
    bind.execute(sa.text(
        "UPDATE licenses "
        "SET contract_id = ("
        "  SELECT id FROM contracts"
        "  WHERE lower(contracts.contract_number) = lower(licenses.contract_number)"
        "  LIMIT 1"
        ") "
        "WHERE contract_number != '' AND contract_number IS NOT NULL AND contract_number != 'None'"
    ))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    license_indexes = {index["name"] for index in inspector.get_indexes("licenses")}
    license_columns = {column["name"] for column in inspector.get_columns("licenses")}

    if "ix_licenses_contract_id" in license_indexes:
        op.drop_index("ix_licenses_contract_id", table_name="licenses")
    if "contract_id" in license_columns:
        op.drop_column("licenses", "contract_id")

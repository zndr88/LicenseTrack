"""enforce lifecycle_status enum constraint

Revision ID: d2e3f4a5b6c7
Revises: c4d5e6f7a8b9
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # Null out any values that don't match the allowed set before adding the
    # constraint, so existing bad data doesn't cause the migration to fail.
    # Using literal IN list to avoid SQLite's lack of expanding bindparam support.
    bind.execute(sa.text(
        "UPDATE licenses SET lifecycle_status = NULL "
        "WHERE lifecycle_status IS NOT NULL "
        "AND lifecycle_status NOT IN ('pending_renewal', 'renewed', 'legacy')"
    ))

    with op.batch_alter_table("licenses") as batch_op:
        batch_op.create_check_constraint(
            "ck_license_lifecycle_status_valid",
            "lifecycle_status IS NULL OR lifecycle_status IN "
            "('pending_renewal', 'renewed', 'legacy')",
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_constraint(
            "ck_license_lifecycle_status_valid", type_="check"
        )

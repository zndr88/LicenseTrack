"""add notice handled state

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-07-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.add_column(sa.Column("notice_handled_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("notice_handled_by_user_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_license_notice_handled_by_user",
            "users",
            ["notice_handled_by_user_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses") as batch_op:
        batch_op.drop_constraint("fk_license_notice_handled_by_user", type_="foreignkey")
        batch_op.drop_column("notice_handled_by_user_id")
        batch_op.drop_column("notice_handled_at")

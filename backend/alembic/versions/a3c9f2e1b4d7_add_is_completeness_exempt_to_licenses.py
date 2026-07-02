"""add_is_completeness_exempt_to_licenses

Revision ID: a3c9f2e1b4d7
Revises: 7e2f8a9b1c3d
Create Date: 2026-03-03 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c9f2e1b4d7"
down_revision: Union[str, None] = "7e2f8a9b1c3d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("licenses", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_completeness_exempt",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("licenses", schema=None) as batch_op:
        batch_op.drop_column("is_completeness_exempt")

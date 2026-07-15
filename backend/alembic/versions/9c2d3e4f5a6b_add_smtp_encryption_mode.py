"""add smtp encryption mode

Revision ID: 9c2d3e4f5a6b
Revises: 8b1c2d3e4f6a
Create Date: 2026-07-15

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "9c2d3e4f5a6b"
down_revision: Union[str, None] = "8b1c2d3e4f6a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "smtp_encryption",
                sa.String(length=20),
                nullable=False,
                server_default="starttls",
            )
        )

    op.execute(
        """
        UPDATE global_settings
        SET smtp_encryption = CASE
            WHEN smtp_use_tls = 1 THEN 'tls'
            ELSE 'starttls'
        END
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.drop_column("smtp_encryption")

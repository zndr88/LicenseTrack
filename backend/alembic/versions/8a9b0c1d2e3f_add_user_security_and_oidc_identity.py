"""add user security version and stable OIDC identity

Revision ID: 8a9b0c1d2e3f
Revises: a4b5c6d7e8f9
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "8a9b0c1d2e3f"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("security_version", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("oidc_issuer", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("oidc_subject", sa.String(length=255), nullable=True))
    op.create_index(
        "uq_users_oidc_identity",
        "users",
        ["oidc_issuer", "oidc_subject"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_users_oidc_identity", table_name="users")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("oidc_subject")
        batch_op.drop_column("oidc_issuer")
        batch_op.drop_column("security_version")

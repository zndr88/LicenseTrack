"""add oidc and break-glass auth fields

Revision ID: 9b7d1e4c2a10
Revises: 4970389793d1
Create Date: 2026-03-31 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b7d1e4c2a10"
down_revision: Union[str, None] = "4970389793d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


auth_provider_enum = sa.Enum("local", "oidc", name="authprovider")


def upgrade() -> None:
    auth_provider_enum.create(op.get_bind(), checkfirst=True)

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("auth_provider", auth_provider_enum, nullable=False, server_default="local")
        )
        batch_op.add_column(
            sa.Column("is_break_glass_admin", sa.Boolean(), nullable=False, server_default="0")
        )

    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("oidc_enabled", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("oidc_discovery_url", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("oidc_client_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("oidc_client_secret", sa.String(length=255), nullable=True))

    op.execute(
        sa.text(
            "UPDATE users SET is_break_glass_admin = 1 "
            "WHERE username = 'admin' AND email = 'admin@localhost'"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("global_settings", schema=None) as batch_op:
        batch_op.drop_column("oidc_client_secret")
        batch_op.drop_column("oidc_client_id")
        batch_op.drop_column("oidc_discovery_url")
        batch_op.drop_column("oidc_enabled")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("is_break_glass_admin")
        batch_op.drop_column("auth_provider")

    auth_provider_enum.drop(op.get_bind(), checkfirst=True)

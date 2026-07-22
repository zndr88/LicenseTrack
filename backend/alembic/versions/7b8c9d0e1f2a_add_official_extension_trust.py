"""add official extension trust metadata

Revision ID: 7b8c9d0e1f2a
Revises: ad6e7f8a9b1c
Create Date: 2026-07-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b8c9d0e1f2a"
down_revision: Union[str, None] = "ad6e7f8a9b1c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("plugins") as batch_op:
        batch_op.add_column(
            sa.Column("trust_status", sa.String(length=30), server_default="unverified", nullable=False)
        )
        batch_op.add_column(sa.Column("signer_key_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("signer_identity", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("plugin_versions") as batch_op:
        batch_op.add_column(sa.Column("signed_content_sha256", sa.String(length=64), nullable=True))
        batch_op.add_column(
            sa.Column("trust_status", sa.String(length=30), server_default="unverified", nullable=False)
        )
        batch_op.add_column(sa.Column("signer_key_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("signer_identity", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))

    # Existing package records predate signature verification. Preserve all
    # registry/settings/suggestion/audit data, but revoke execution state.
    op.execute(
        sa.text(
            "UPDATE plugins SET enabled = 0, status = 'unverified', trust_status = 'unverified', "
            "last_error = 'Package predates Official Extension signature verification; reinstall a signed release.'"
        )
    )
    op.execute(sa.text("UPDATE plugin_actions SET enabled = 0"))
    op.execute(
        sa.text(
            "UPDATE plugin_runtime_status SET pid = NULL, port = NULL, health = 'stopped', "
            "last_error = 'Package is not verified as an Official Extension.'"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("plugin_versions") as batch_op:
        batch_op.drop_column("verified_at")
        batch_op.drop_column("signer_identity")
        batch_op.drop_column("signer_key_id")
        batch_op.drop_column("trust_status")
        batch_op.drop_column("signed_content_sha256")

    with op.batch_alter_table("plugins") as batch_op:
        batch_op.drop_column("verified_at")
        batch_op.drop_column("signer_identity")
        batch_op.drop_column("signer_key_id")
        batch_op.drop_column("trust_status")

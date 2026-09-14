"""Prevent SQLite from reusing deleted user IDs.

JWT subjects identify user rows by ID, so reusing an ID could allow a valid
token for a deleted account to authenticate a newly created account.
"""

from collections.abc import Sequence

from alembic import op


revision: str = "c1a2b3d4e5f6"
down_revision: str | None = "a21b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table(
        "users",
        recreate="always",
        table_kwargs={"sqlite_autoincrement": True},
    ):
        pass


def downgrade() -> None:
    with op.batch_alter_table("users", recreate="always"):
        pass

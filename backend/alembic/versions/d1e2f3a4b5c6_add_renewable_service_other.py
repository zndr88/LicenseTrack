"""Add opt-in renewability and a type description for Service/Other lines.

``is_renewable`` is NULL for every existing row: NULL means "derive from the
license type", and Service/Other treat NULL as not renewable, so upgraded data
keeps its current behavior.
"""

from alembic import op
import sqlalchemy as sa


revision = "d1e2f3a4b5c6"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("licenses", "sourcing_items"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("is_renewable", sa.Boolean(), nullable=True))
            batch.add_column(sa.Column("type_description", sa.String(length=255), nullable=True))


def downgrade() -> None:
    for table in ("sourcing_items", "licenses"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("type_description")
            batch.drop_column("is_renewable")

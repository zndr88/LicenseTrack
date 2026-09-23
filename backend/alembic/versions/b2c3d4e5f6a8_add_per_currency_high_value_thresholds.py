"""Add per-currency high-value thresholds for the Renewal Workbench.

The old single ``high_value_threshold`` column stays for read compatibility but
is no longer used. Its value is mapped once to the display currency: the
earliest admin's display currency, else the most common one, else EUR. A
currency without a threshold is never flagged as high value.
"""

import json
from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "b2c3d4e5f6a8"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def _display_currency(connection) -> str:
    admin_currency = connection.execute(
        sa.text(
            "SELECT us.display_currency FROM user_settings us "
            "JOIN users u ON u.id = us.user_id "
            "WHERE u.role = 'admin' AND us.display_currency IS NOT NULL AND us.display_currency != '' "
            "ORDER BY u.id LIMIT 1"
        )
    ).scalar()
    if admin_currency:
        return str(admin_currency).strip().upper()
    common_currency = connection.execute(
        sa.text(
            "SELECT display_currency FROM user_settings "
            "WHERE display_currency IS NOT NULL AND display_currency != '' "
            "GROUP BY display_currency ORDER BY COUNT(*) DESC, display_currency LIMIT 1"
        )
    ).scalar()
    return str(common_currency).strip().upper() if common_currency else "EUR"


def upgrade() -> None:
    with op.batch_alter_table("global_settings") as batch:
        batch.add_column(sa.Column("high_value_thresholds", sa.JSON(), nullable=False, server_default="{}"))

    connection = op.get_bind()
    columns = {column["name"] for column in sa.inspect(connection).get_columns("global_settings")}
    if "high_value_threshold" not in columns:
        return
    old_threshold = connection.execute(
        sa.text("SELECT high_value_threshold FROM global_settings WHERE id = 1")
    ).scalar()
    if old_threshold is not None:
        mapped = {_display_currency(connection): format(Decimal(str(old_threshold)).normalize(), "f")}
        connection.execute(
            sa.text("UPDATE global_settings SET high_value_thresholds = :thresholds WHERE id = 1"),
            {"thresholds": json.dumps(mapped)},
        )


def downgrade() -> None:
    with op.batch_alter_table("global_settings") as batch:
        batch.drop_column("high_value_thresholds")

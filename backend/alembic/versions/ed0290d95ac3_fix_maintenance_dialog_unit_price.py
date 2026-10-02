"""fix maintenance dialog unit price

The Add Maintenance dialog stored the coverage-period cost as the unit price
while copying the parent's quantity, so quantity x unit price overstated the
cost. Only rows with that exact signature are corrected, along with the copy
of their cost that the covered parent keeps.

Revision ID: ed0290d95ac3
Revises: 2ce70b265de2
Create Date: 2026-10-02 14:20:00.000000

"""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ed0290d95ac3'
down_revision: Union[str, None] = '2ce70b265de2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PLACES = Decimal("0.000001")


def _canonical(value: Decimal) -> str:
    text = format(value.quantize(_PLACES, rounding=ROUND_HALF_UP), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("licenses")}
    if not {"license_type", "parent_license_id", "quantity", "unit_price", "total_po_price"} <= columns:
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, quantity, unit_price FROM licenses "
            "WHERE license_type = 'maintenance' AND parent_license_id IS NOT NULL "
            "AND unit_price <> '' AND unit_price = total_po_price"
        )
    ).fetchall()
    # A parent keeps a copy of its active maintenance child's cost; correct that
    # copy for the children fixed below.
    update_parent_mirror = {"active_maintenance_id", "maintenance_cost"} <= columns
    for row in rows:
        try:
            quantity = Decimal(row.quantity)
            total = Decimal(row.unit_price)
        except (InvalidOperation, TypeError):
            continue
        if quantity <= 1:
            continue
        unit = _canonical(total / quantity)
        bind.execute(
            sa.text("UPDATE licenses SET unit_price = :unit WHERE id = :id"),
            {"unit": unit, "id": row.id},
        )
        if update_parent_mirror:
            bind.execute(
                sa.text("UPDATE licenses SET maintenance_cost = :cost WHERE active_maintenance_id = :id"),
                {"cost": format(quantity * Decimal(unit), "f"), "id": row.id},
            )


def downgrade() -> None:
    # Data correction; the previous (overstated) values are not restored.
    pass

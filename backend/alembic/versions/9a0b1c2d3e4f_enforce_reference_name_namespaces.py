"""Enforce canonical and alias reference-name namespaces.

Existing collisions deliberately abort the upgrade. Operators must resolve
those records before the cross-table invariant can be enabled.
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "9a0b1c2d3e4f"
down_revision: str = "8b9c0d1e2f3a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _assert_no_collisions(conn, canonical: str, aliases: str, label: str) -> None:
    rows = conn.execute(
        text(
            f"SELECT normalized_name FROM {canonical} INTERSECT "
            f"SELECT normalized_name FROM {aliases}"
        )
    ).fetchall()
    if rows:
        names = ", ".join(row[0] for row in rows[:10])
        raise RuntimeError(f"Cannot enable {label} reference-name namespace; existing collisions: {names}")


def upgrade() -> None:
    conn = op.get_bind()
    _assert_no_collisions(conn, "organizations", "organization_aliases", "organization")
    _assert_no_collisions(conn, "cost_centres", "cost_centre_aliases", "cost-centre")
    conn.execute(text("""
        CREATE TRIGGER reference_organization_name_namespace_insert
        BEFORE INSERT ON organizations
        WHEN EXISTS (SELECT 1 FROM organization_aliases WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'organization reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_organization_name_namespace_update
        BEFORE UPDATE OF normalized_name ON organizations
        WHEN EXISTS (SELECT 1 FROM organization_aliases WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'organization reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_organization_alias_namespace_insert
        BEFORE INSERT ON organization_aliases
        WHEN EXISTS (SELECT 1 FROM organizations WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'organization reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_organization_alias_namespace_update
        BEFORE UPDATE OF normalized_name ON organization_aliases
        WHEN EXISTS (SELECT 1 FROM organizations WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'organization reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_cost_centre_name_namespace_insert
        BEFORE INSERT ON cost_centres
        WHEN EXISTS (SELECT 1 FROM cost_centre_aliases WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'cost-centre reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_cost_centre_name_namespace_update
        BEFORE UPDATE OF normalized_name ON cost_centres
        WHEN EXISTS (SELECT 1 FROM cost_centre_aliases WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'cost-centre reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_cost_centre_alias_namespace_insert
        BEFORE INSERT ON cost_centre_aliases
        WHEN EXISTS (SELECT 1 FROM cost_centres WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'cost-centre reference name already exists'); END
    """))
    conn.execute(text("""
        CREATE TRIGGER reference_cost_centre_alias_namespace_update
        BEFORE UPDATE OF normalized_name ON cost_centre_aliases
        WHEN EXISTS (SELECT 1 FROM cost_centres WHERE normalized_name = NEW.normalized_name)
        BEGIN SELECT RAISE(ABORT, 'cost-centre reference name already exists'); END
    """))


def downgrade() -> None:
    conn = op.get_bind()
    for name in (
        "reference_organization_name_namespace_insert",
        "reference_organization_name_namespace_update",
        "reference_organization_alias_namespace_insert",
        "reference_organization_alias_namespace_update",
        "reference_cost_centre_name_namespace_insert",
        "reference_cost_centre_name_namespace_update",
        "reference_cost_centre_alias_namespace_insert",
        "reference_cost_centre_alias_namespace_update",
    ):
        conn.execute(text(f"DROP TRIGGER IF EXISTS {name}"))

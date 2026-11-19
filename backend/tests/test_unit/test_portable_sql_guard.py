"""Guards against SQL that only one database accepts."""

import re
from pathlib import Path

from sqlalchemy import Boolean, CheckConstraint

import app.models  # noqa: F401  (registers every table)
from app.database import Base

APP_DIR = Path(__file__).resolve().parents[2] / "app"


def test_check_constraints_do_not_compare_booleans_with_numbers():
    offenders = []
    for table in Base.metadata.tables.values():
        boolean_columns = {c.name for c in table.columns if isinstance(c.type, Boolean)}
        for constraint in table.constraints:
            if not isinstance(constraint, CheckConstraint):
                continue
            text = str(constraint.sqltext)
            for name in boolean_columns:
                if re.search(rf"\b{name}\s*(=|!=|<>)\s*[01]\b", text):
                    offenders.append(f"{table.name}.{constraint.name}: {name}")
    assert offenders == [], f"Use true/false, not 0/1, for boolean columns: {offenders}"


def test_row_locks_name_the_table_they_lock():
    """A bare with_for_update() breaks on PostgreSQL when the entity eager-joins another table."""
    allowed = {"license_service.py"}  # LicenseRefSequence: single table, no joins
    offenders = [
        f"{path.relative_to(APP_DIR)}:{number}"
        for path in APP_DIR.rglob("*.py")
        if path.name not in allowed
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        if ".with_for_update()" in line
    ]
    assert offenders == [], f"Use with_for_update(of=Model): {offenders}"

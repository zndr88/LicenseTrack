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

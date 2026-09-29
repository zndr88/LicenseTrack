"""One matching rule for LT-Refs written in import files.

Every import lookup by LT-Ref (update targets, renewal predecessors and
maintenance parents) uses these helpers, so a reference means the same thing
everywhere: surrounding spaces and letter case are ignored. Each caller still
applies its own filter (for example, only the newest term in a renewal chain).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement

from app.models.license import License


def ref_key(ref: str | None) -> str:
    """The comparable form of an LT-Ref: trimmed and lowercase ('' when blank)."""
    return (ref or "").strip().lower()


def license_ref_matches(ref: str) -> ColumnElement[bool]:
    """SQL condition: the license's LT-Ref equals ``ref`` under the import rule."""
    return func.lower(License.license_ref) == ref_key(ref)


def license_ref_in(refs: set[str]) -> ColumnElement[bool]:
    """SQL condition: the license's LT-Ref is one of ``refs`` under the import rule."""
    return func.lower(License.license_ref).in_({ref_key(ref) for ref in refs})

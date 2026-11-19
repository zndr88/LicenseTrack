"""SQL building blocks that behave the same on SQLite and PostgreSQL.

Use these instead of database-specific functions (json_type, json_each,
max(a, b), BEGIN IMMEDIATE). One owner per construct.
"""

from sqlalchemy import String, case, cast, literal, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement


def json_list_is_empty(column) -> ColumnElement[bool]:
    """True when a JSON list column holds SQL NULL, JSON null or an empty list."""
    return or_(column.is_(None), cast(column, String).in_(("null", "[]")))


def greatest(first, *others) -> ColumnElement:
    """The largest of the given values (SQLite: max(a, b); PostgreSQL: GREATEST)."""
    is_sql = isinstance(first, ColumnElement) or hasattr(first, "__clause_element__")
    result = first if is_sql else literal(first)
    for other in others:
        result = case((result >= other, result), else_=other)
    return result


async def lock_out_other_writers(db: AsyncSession, tables: tuple[str, ...]) -> None:
    """Start a transaction in which no other connection can write to *tables*.

    Call right after a commit. SQLite has one writer at a time, so reserving
    the write lock is enough; PostgreSQL locks the named tables until the
    transaction ends. Table names come from code, never from user input.
    """
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        await db.execute(text("BEGIN IMMEDIATE"))
    elif dialect == "postgresql":
        await db.execute(text(f"LOCK TABLE {', '.join(tables)} IN SHARE ROW EXCLUSIVE MODE"))
    else:
        raise RuntimeError(f"Unsupported database: {dialect}")

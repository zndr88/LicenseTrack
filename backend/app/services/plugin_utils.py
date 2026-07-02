from __future__ import annotations

from typing import Any


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    result: list[int] = []
    for item in value:
        parsed = int_or_none(item)
        if parsed is not None:
            result.append(parsed)
    return result

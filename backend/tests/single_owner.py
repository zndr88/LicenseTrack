r"""Guard helper: a rule's literal definition may live only in its owner file.

Usage in a guard test:

    from pathlib import Path
    from tests.single_owner import find_definitions

    APP = Path(__file__).resolve().parents[2] / "app"

    def test_open_pending_order_statuses_have_one_owner():
        assert find_definitions(
            APP,
            r"PendingOrderStatus\.pending,\s*PendingOrderStatus\.invoice_received",
            owners={"models/pending_order.py"},
        ) == []

The result lists "relative/path.py:line" for every match outside the owners,
so a failing guard names exactly where the copy is.
"""

from __future__ import annotations

import re
from pathlib import Path


def find_definitions(
    root: Path,
    pattern: str,
    *,
    owners: set[str],
    suffixes: tuple[str, ...] = (".py",),
) -> list[str]:
    """Return "path:line" for each match of *pattern* under *root* outside *owners*.

    *owners* are paths relative to *root* using forward slashes. Each owner
    must exist, so a renamed owner can't silently disable the guard.
    """
    for owner in owners:
        assert (root / owner).is_file(), f"owner file missing: {owner}"
    regex = re.compile(pattern)
    hits: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in suffixes or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(root).as_posix()
        if relative in owners:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if regex.search(line):
                hits.append(f"{relative}:{number}")
    return hits

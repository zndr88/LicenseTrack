from pathlib import Path

from tests.single_owner import find_definitions


BACKEND = Path(__file__).resolve().parents[2]


def _dependencies(name):
    return {line.strip().lower() for line in (BACKEND / name).read_text().splitlines() if line.strip() and not line.startswith("#")}


def test_runtime_dependencies_match_development_pins():
    assert _dependencies("requirements-runtime.txt") <= _dependencies("requirements.txt")


def test_unused_scheduler_does_not_ship():
    for name in ("requirements.txt", "requirements-runtime.txt"):
        assert not any(line.startswith("apscheduler") for line in _dependencies(name))
    assert find_definitions(BACKEND / "app", r"\bapscheduler\b", owners=set()) == []

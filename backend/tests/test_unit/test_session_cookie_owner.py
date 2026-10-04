from pathlib import Path

from tests.single_owner import find_definitions


def test_unused_session_cookie_clearer_stays_removed():
    app = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(app, r"\bclear_session_cookie\b", owners=set()) == []

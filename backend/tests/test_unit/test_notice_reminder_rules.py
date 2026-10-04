from pathlib import Path
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.notice_reminder_rules import clear_notice_handled_if_date_changed

from tests.single_owner import find_definitions


@pytest.mark.parametrize("new_date", [date(2026, 10, 1), date(2026, 10, 2), None])
def test_notice_reset_preserves_only_unchanged_dates(new_date):
    handled = datetime(2026, 9, 1, tzinfo=timezone.utc)
    license_obj = SimpleNamespace(notice_date=date(2026, 10, 1), notice_handled_at=handled, notice_handled_by_user_id=7)
    clear_notice_handled_if_date_changed(license_obj, new_date)
    unchanged = new_date == license_obj.notice_date
    assert license_obj.notice_handled_at == (handled if unchanged else None)
    assert license_obj.notice_handled_by_user_id == (7 if unchanged else None)


def test_notice_handled_reset_has_one_owner():
    app = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(
        app,
        r"\.notice_handled_(?:at|by_user_id)\s*=\s*None",
        owners={"services/notice_reminder_rules.py"},
    ) == []

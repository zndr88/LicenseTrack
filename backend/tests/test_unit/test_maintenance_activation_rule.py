from datetime import date
from types import SimpleNamespace

from app.services.maintenance_service import choose_active_maintenance

TODAY = date(2026, 6, 1)


def record(id_, start, end, retired=False):
    return SimpleNamespace(id=id_, start_date=start, end_date=end, is_retired=retired)


def test_keeps_current_record_while_it_covers_today():
    current = record(1, date(2026, 1, 1), date(2026, 12, 31))
    overlapping = record(2, date(2026, 5, 1), date(2027, 4, 30))
    assert choose_active_maintenance([current, overlapping], current_id=1, today=TODAY) is current


def test_ended_record_never_displaces_a_covering_record():
    covering = record(1, date(2026, 1, 1), date(2026, 12, 31))
    ended = record(2, date(2024, 1, 1), date(2024, 12, 31))
    assert choose_active_maintenance([covering, ended], current_id=2, today=TODAY) is covering


def test_latest_start_wins_among_covering_records():
    older = record(1, date(2025, 6, 1), date(2026, 12, 31))
    newer = record(2, date(2026, 3, 1), date(2027, 2, 28))
    assert choose_active_maintenance([older, newer], current_id=None, today=TODAY) is newer


def test_gap_keeps_most_recently_ended_record():
    ended_old = record(1, date(2024, 1, 1), date(2024, 12, 31))
    ended_recent = record(2, date(2025, 1, 1), date(2025, 12, 31))
    future = record(3, date(2026, 9, 1), date(2027, 8, 31))
    assert choose_active_maintenance([ended_old, ended_recent, future], current_id=None, today=TODAY) is ended_recent


def test_only_future_records_pick_the_earliest():
    later = record(1, date(2027, 1, 1), date(2027, 12, 31))
    sooner = record(2, date(2026, 9, 1), date(2027, 8, 31))
    assert choose_active_maintenance([later, sooner], current_id=None, today=TODAY) is sooner


def test_retired_records_are_ignored_and_empty_gives_none():
    retired = record(1, date(2026, 1, 1), date(2026, 12, 31), retired=True)
    assert choose_active_maintenance([retired], current_id=1, today=TODAY) is None
    assert choose_active_maintenance([], current_id=None, today=TODAY) is None

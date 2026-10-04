from pathlib import Path

import pytest

from app.routes import auth_oidc
from app.services.auth_attempt_tracking import enforce_key_cap, recent_attempts
from tests.single_owner import find_definitions


@pytest.fixture(autouse=True)
def clear_oidc_attempts():
    auth_oidc._oidc_attempts.clear()
    yield
    auth_oidc._oidc_attempts.clear()


def test_oidc_unique_addresses_remain_bounded(monkeypatch):
    monkeypatch.setattr(auth_oidc, "_MAX_TRACKED_KEYS", 3)
    monkeypatch.setattr(auth_oidc, "time", lambda: 1000.0)
    for index in range(20):
        ip = f"192.0.2.{index}"
        assert auth_oidc._check_oidc_rate_limit(ip)
        auth_oidc._record_oidc_attempt(ip)
        assert len(auth_oidc._oidc_attempts) <= 3
    assert set(auth_oidc._oidc_attempts) == {"192.0.2.17", "192.0.2.18", "192.0.2.19"}


def test_expired_entries_are_pruned_before_active_entries_are_evicted():
    store = {"active": [950.0], "expired": [700.0], "new": [1000.0]}
    enforce_key_cap(store, 1000.0, 300, 2)
    assert store == {"active": [950.0], "new": [1000.0]}


def test_rate_limit_check_does_not_keep_empty_or_expired_keys(monkeypatch):
    monkeypatch.setattr(auth_oidc, "time", lambda: 1000.0)
    auth_oidc._oidc_attempts["expired"] = [700.0]
    assert auth_oidc._check_oidc_rate_limit("expired")
    assert auth_oidc._check_oidc_rate_limit("new")
    assert auth_oidc._oidc_attempts == {}


def test_successful_oidc_attempt_releases_only_its_reservation(monkeypatch):
    monkeypatch.setattr(auth_oidc, "time", lambda: 1000.0)
    attempt = auth_oidc._record_oidc_attempt("shared")
    auth_oidc._oidc_attempts["shared"].append(999.0)
    auth_oidc._release_oidc_attempt("shared", attempt)
    assert auth_oidc._oidc_attempts["shared"] == [999.0]
    auth_oidc._release_oidc_attempt("shared", 999.0)
    assert "shared" not in auth_oidc._oidc_attempts


def test_releasing_evicted_reservation_does_not_recreate_key(monkeypatch):
    monkeypatch.setattr(auth_oidc, "_MAX_TRACKED_KEYS", 1)
    monkeypatch.setattr(auth_oidc, "time", lambda: 1000.0)
    attempt = auth_oidc._record_oidc_attempt("old")
    auth_oidc._record_oidc_attempt("new")
    auth_oidc._release_oidc_attempt("old", attempt)
    assert set(auth_oidc._oidc_attempts) == {"new"}


def test_oidc_failed_and_in_flight_attempts_still_share_limit(monkeypatch):
    monkeypatch.setattr(auth_oidc, "time", lambda: 1000.0)
    for _ in range(auth_oidc._MAX_ATTEMPTS):
        assert auth_oidc._check_oidc_rate_limit("shared")
        auth_oidc._record_oidc_attempt("shared")
    assert not auth_oidc._check_oidc_rate_limit("shared")
    monkeypatch.setattr(auth_oidc, "time", lambda: 1300.0)
    assert auth_oidc._check_oidc_rate_limit("shared")


def test_recent_attempts_retains_only_the_current_window():
    store = {"client": [699.0, 700.0, 701.0, 999.0]}
    assert recent_attempts(store, "client", 1000.0, 300) == [701.0, 999.0]


def test_authentication_tracking_and_request_header_have_single_owners():
    app = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(
        app, r"^(?:_?MAX_TRACKED_KEYS\s*=|def (?:_enforce_key_cap|enforce_key_cap|_prune_expired|recent_attempts)\()",
        owners={"services/auth_attempt_tracking.py"},
    ) == []
    assert find_definitions(
        app, r'(?:SESSION_REQUEST_HEADER\s*=|detail="Missing application request header")',
        owners={"dependencies.py"},
    ) == []

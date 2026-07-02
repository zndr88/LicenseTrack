"""Unit tests for UserSettingsUpdate allowlist validators."""
import pytest
from pydantic import ValidationError

from app.schemas.settings import UserSettingsUpdate, UserSettingsResponse


# ── date_format ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("valid", ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"])
def test_user_settings_update_date_format_valid(valid):
    m = UserSettingsUpdate(date_format=valid)
    assert m.date_format == valid


@pytest.mark.parametrize("bad", ["d/m/y", "invalid", "YY/MM/DD", ""])
def test_user_settings_update_date_format_invalid(bad):
    with pytest.raises(ValidationError):
        UserSettingsUpdate(date_format=bad)


# ── time_format ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("valid", ["12h", "24h"])
def test_user_settings_update_time_format_valid(valid):
    m = UserSettingsUpdate(time_format=valid)
    assert m.time_format == valid


def test_user_settings_update_time_format_invalid():
    with pytest.raises(ValidationError):
        UserSettingsUpdate(time_format="6h")


# ── number_format_locale ──────────────────────────────────────────────────────

@pytest.mark.parametrize("valid", ["en-US", "nl-BE", "de-DE", "fr-FR"])
def test_user_settings_update_number_format_locale_valid(valid):
    m = UserSettingsUpdate(number_format_locale=valid)
    assert m.number_format_locale == valid


@pytest.mark.parametrize("bad", ["xx-INVALID", "not-a-locale", ""])
def test_user_settings_update_number_format_locale_invalid(bad):
    with pytest.raises(ValidationError):
        UserSettingsUpdate(number_format_locale=bad)


# ── time_zone ─────────────────────────────────────────────────────────────────

def test_user_settings_update_time_zone_valid():
    m = UserSettingsUpdate(time_zone="Europe/Brussels")
    assert m.time_zone == "Europe/Brussels"


@pytest.mark.parametrize("bad", ["Mars/Olympus", "not_a_tz", "UTC+5"])
def test_user_settings_update_time_zone_invalid(bad):
    with pytest.raises(ValidationError):
        UserSettingsUpdate(time_zone=bad)


def test_user_settings_update_time_zone_utc_valid():
    m = UserSettingsUpdate(time_zone="UTC")
    assert m.time_zone == "UTC"


# ── UserSettingsResponse has defaults ────────────────────────────────────────

def test_user_settings_response_has_date_format_default():
    assert UserSettingsResponse.model_fields["date_format"].default == "DD/MM/YYYY"


def test_user_settings_response_has_time_format_default():
    assert UserSettingsResponse.model_fields["time_format"].default == "24h"


def test_user_settings_response_has_time_zone_default():
    assert UserSettingsResponse.model_fields["time_zone"].default == "UTC"

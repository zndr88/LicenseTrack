"""
Unit tests for app.services.money — the single canonical money parser/validator.

Step 0 spec: parse_money accepts canonical decimal strings only and raises
MoneyParseError on anything with symbols, grouping separators, or locale commas.
is_canonical_money mirrors that logic as a bool predicate.
"""
from decimal import Decimal

import pytest

from app.services.money import MoneyParseError, is_canonical_money, parse_money


# ---------------------------------------------------------------------------
# is_canonical_money
# ---------------------------------------------------------------------------

class TestIsCanonicalMoney:
    # --- Valid canonical values ---
    def test_integer(self):
        assert is_canonical_money("1234") is True

    def test_decimal_two_places(self):
        assert is_canonical_money("1234.50") is True

    def test_zero(self):
        assert is_canonical_money("0") is True

    def test_zero_decimal(self):
        assert is_canonical_money("0.00") is True

    def test_negative_decimal(self):
        assert is_canonical_money("-50.00") is True

    def test_negative_integer(self):
        assert is_canonical_money("-50") is True

    def test_small_decimal(self):
        assert is_canonical_money("0.5") is True

    # --- Non-canonical cases ---
    def test_rejects_euro_symbol(self):
        assert is_canonical_money("€100") is False

    def test_rejects_dollar_symbol(self):
        assert is_canonical_money("$100") is False

    def test_rejects_pound_symbol(self):
        assert is_canonical_money("£100") is False

    def test_rejects_us_thousands_separator(self):
        assert is_canonical_money("1,234.50") is False

    def test_rejects_eu_decimal_comma(self):
        assert is_canonical_money("1.234,50") is False

    def test_rejects_fr_space_separator(self):
        assert is_canonical_money("1 234,50") is False

    def test_rejects_bare_comma(self):
        assert is_canonical_money("1234,50") is False

    def test_rejects_symbol_with_space(self):
        assert is_canonical_money("€ 100") is False

    def test_rejects_iso_prefix(self):
        assert is_canonical_money("EUR 100") is False


# ---------------------------------------------------------------------------
# parse_money
# ---------------------------------------------------------------------------

class TestParseMoney:
    # --- Blank / null ---
    def test_none_returns_none(self):
        assert parse_money(None) is None

    def test_empty_string_returns_none(self):
        assert parse_money("") is None

    def test_whitespace_only_returns_none(self):
        assert parse_money("   ") is None

    # --- Valid canonical ---
    def test_canonical_decimal(self):
        assert parse_money("1234.50") == Decimal("1234.50")

    def test_canonical_integer(self):
        assert parse_money("1234") == Decimal("1234")

    def test_canonical_zero(self):
        assert parse_money("0") == Decimal("0")

    def test_canonical_negative(self):
        assert parse_money("-50.00") == Decimal("-50.00")

    # --- Non-canonical raises MoneyParseError ---
    def test_rejects_euro_symbol(self):
        with pytest.raises(MoneyParseError):
            parse_money("€100")

    def test_rejects_dollar_symbol(self):
        with pytest.raises(MoneyParseError):
            parse_money("$100")

    def test_rejects_us_thousands(self):
        with pytest.raises(MoneyParseError):
            parse_money("1,234.50")

    def test_rejects_eu_decimal_comma(self):
        with pytest.raises(MoneyParseError):
            parse_money("1.234,50")

    def test_rejects_fr_space(self):
        with pytest.raises(MoneyParseError):
            parse_money("1 234,50")

    def test_rejects_bare_comma(self):
        with pytest.raises(MoneyParseError):
            parse_money("1234,50")

    def test_error_message_mentions_value(self):
        with pytest.raises(MoneyParseError, match="€100"):
            parse_money("€100")

    def test_money_parse_error_is_value_error(self):
        """MoneyParseError must subclass ValueError so Pydantic field_validators propagate it."""
        with pytest.raises(ValueError):
            parse_money("€100")


# ---------------------------------------------------------------------------
# parse_localized_money
# ---------------------------------------------------------------------------

class TestParseLocalizedMoney:
    # --- Blank / null ---
    def test_none_returns_none(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money(None, "en-US") is None

    def test_empty_string_returns_none(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("", "en-US") is None

    def test_whitespace_only_returns_none(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("   ", "en-US") is None

    # --- Already canonical — accepted as-is ---
    def test_canonical_passthrough_en_us(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1234.50", "en-US") == "1234.50"

    def test_canonical_passthrough_de_de(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1234.50", "de-DE") == "1234.50"

    # --- en-US: comma group separator, period decimal ---
    def test_en_us_thousands_stripped(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1,234.50", "en-US") == "1234.50"

    def test_en_us_large_number(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1,000,000.00", "en-US") == "1000000.00"

    # --- de-DE: period group separator, comma decimal ---
    def test_de_de_period_group_comma_decimal(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1.234,50", "de-DE") == "1234.50"

    def test_de_de_bare_comma_decimal(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1234,50", "de-DE") == "1234.50"

    def test_de_de_integer(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1.000", "de-DE") == "1000"

    # --- fr-FR: narrow no-break space group, comma decimal ---
    def test_fr_fr_nbspace_group(self):
        from app.services.money import parse_localized_money
        # narrow no-break space U+00A0 as group sep
        assert parse_localized_money("1\u00a0234,50", "fr-FR") == "1234.50"

    def test_fr_fr_plain_space_group(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("1 234,50", "fr-FR") == "1234.50"

    # --- Unknown locale falls back to en-US conventions ---
    def test_unknown_locale_fallback(self):
        from app.services.money import parse_localized_money
        # Unknown locale → en-US defaults (period decimal, comma group)
        assert parse_localized_money("1,234.50", "xx-XX") == "1234.50"

    # --- Currency affixes common in CSV exports ---
    def test_accepts_currency_symbol_affix(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("€11.000,00", "de-DE") == "11000.00"

    def test_accepts_currency_code_affix(self):
        from app.services.money import parse_localized_money
        assert parse_localized_money("EUR 11.000,00", "de-DE") == "11000.00"

    # --- Unparseable → MoneyParseError ---

    def test_rejects_garbage(self):
        from app.services.money import parse_localized_money
        with pytest.raises(MoneyParseError):
            parse_localized_money("not-a-number", "en-US")

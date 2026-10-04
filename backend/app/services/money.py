"""
Canonical money parser and validator.

The canonical format for money (and numeric quantities) stored in the DB is a
plain decimal string: optional leading minus, one or more digits, optional
decimal point followed by one or more digits.  Examples: "0", "1234", "1234.50",
"-50.00".

Non-canonical values (currency symbols, grouping separators, locale decimal
commas) are rejected by parse_money and flagged by is_canonical_money.
Localized CSV import values are normalized by parse_localized_money first.

This is the single source of truth for the backend.  The CSV import path and
the aggregation layer must both call these functions - there must be exactly one
money parser in the backend.
"""

from __future__ import annotations

import re
from decimal import Decimal

# Pattern for canonical decimal: optional minus, digits, optional fractional part.
_CANONICAL_RE = re.compile(r"^-?\d+(\.\d+)?$")
_CURRENCY_SYMBOLS = frozenset("$€£¥₹₩₪₺₽")
_CURRENCY_CODES = frozenset(
    "AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF ILS INR JPY KRW MXN NOK NZD PLN RON SEK SGD USD ZAR".split()
)

# Locale separator lookup: (decimal_sep, group_sep).
# group_sep of None means the locale uses no grouping character in practice.
# Falls back to en-US defaults (".", ",") for unrecognised locales.
_LOCALE_SEPS: dict[str, tuple[str, str | None]] = {
    "en-US": (".", ","),
    "en-GB": (".", ","),
    "en-AU": (".", ","),
    "en-CA": (".", ","),
    "en-NZ": (".", ","),
    "de-DE": (",", "."),
    "de-AT": (",", "."),
    "de-CH": (".", "'"),
    "fr-FR": (",", "\u00a0"),
    "fr-BE": (",", "."),
    "fr-CH": (".", "'"),
    "fr-CA": (",", "\u00a0"),
    "nl-NL": (",", "."),
    "nl-BE": (",", "."),
    "it-IT": (",", "."),
    "es-ES": (",", "."),
    "es-MX": (".", ","),
    "es-AR": (",", "."),
    "pt-BR": (",", "."),
    "pt-PT": (",", "\u00a0"),
    "pl-PL": (",", "\u00a0"),
    "sv-SE": (",", "\u00a0"),
    "da-DK": (",", "."),
    "nb-NO": (",", "\u00a0"),
    "fi-FI": (",", "\u00a0"),
    "ja-JP": (".", ","),
    "zh-CN": (".", ","),
    "zh-TW": (".", ","),
    "ko-KR": (".", ","),
    "ru-RU": (",", "\u00a0"),
    "tr-TR": (",", "."),
    "ar-SA": (".", ","),
    "he-IL": (".", ","),
    "cs-CZ": (",", "\u00a0"),
    "hu-HU": (",", "\u00a0"),
    "ro-RO": (",", "."),
    "sk-SK": (",", "\u00a0"),
    "bg-BG": (",", "\u00a0"),
    "hr-HR": (",", "."),
}
SUPPORTED_NUMBER_FORMAT_LOCALES = frozenset(_LOCALE_SEPS)


class MoneyParseError(ValueError):
    """Raised when a value is not a canonical decimal money string."""


class AmbiguousNumberError(MoneyParseError):
    """Raised for input like "1.234" under a comma-decimal, dot-grouping format.

    It could mean 1234 (a thousands group) or 1.234 (a decimal point), so it is
    rejected instead of guessed.
    """


def _strip_currency_affixes(raw: str) -> str:
    """Remove supported currency symbols/codes without backtracking regexes."""
    value = raw.strip()
    if value[:1] in _CURRENCY_SYMBOLS:
        value = value[1:].strip()
    if value[-1:] in _CURRENCY_SYMBOLS:
        value = value[:-1].strip()

    prefix_parts = value.split(maxsplit=1)
    if len(prefix_parts) == 2 and prefix_parts[0].upper() in _CURRENCY_CODES:
        value = prefix_parts[1].strip()

    suffix_parts = value.rsplit(maxsplit=1)
    if len(suffix_parts) == 2 and suffix_parts[1].upper() in _CURRENCY_CODES:
        value = suffix_parts[0].strip()
    return value


def is_canonical_money(raw: str) -> bool:
    """Return True iff *raw* is a canonical decimal string (e.g. '1234.50')."""
    return bool(_CANONICAL_RE.match(raw.strip()))


def number_format_separators(number_format_locale: str) -> tuple[str, str | None]:
    """(decimal separator, group separator) for a number format; en-US when unknown."""
    return _LOCALE_SEPS.get(number_format_locale, (".", ","))


_WHITESPACE_RE = re.compile(r"[\s\u00a0\u202f\u2009]")
# A single dot group ("1.234", "-12.345") under a dot-grouping, comma-decimal format.
_AMBIGUOUS_DOT_RE = re.compile(r"^-?[1-9]\d{0,2}\.\d{3}$")


def validate_canonical_money(value: object) -> object:
    """Reject non-canonical request strings; leave schema coercion to Pydantic."""
    if value is None or value == "":
        return value
    if isinstance(value, str) and not is_canonical_money(value):
        raise ValueError(f"Money values must be plain decimal strings (e.g. '1234.50'); got {value!r}.")
    return value


def parse_localized_money(raw: str | None, number_format_locale: str) -> str | None:
    """Convert typed or imported number text to a canonical decimal string.

    The same rules as the frontend's parseTypedNumberResult; both run the
    shared cases in tests/fixtures/number_parsing_cases.json.

    - Blank input returns None. Currency symbols and codes, and any whitespace
      (used as grouping), are ignored.
    - Accepted: plain digits with the format's decimal separator ("1234,5"),
      or correctly grouped digits ("1.234,5", "1.234.567"). A dot that can't
      be grouping is read as a decimal point ("1.5", "1234.567").
    - Rejected with AmbiguousNumberError: a single dot group under a
      dot-grouping, comma-decimal format ("1.234").
    - Rejected with MoneyParseError: anything else, including another
      format's separators ("2,443.00" under de-DE).
    """
    if raw is None or not raw.strip():
        return None
    s = _WHITESPACE_RE.sub("", _strip_currency_affixes(raw))
    if not s:
        return None
    dec_sep, grp_sep = number_format_separators(number_format_locale)
    grp_sep = None if grp_sep is None or _WHITESPACE_RE.fullmatch(grp_sep) else grp_sep

    if is_canonical_money(s):
        if dec_sep != "." and grp_sep == "." and _AMBIGUOUS_DOT_RE.match(s):
            raise AmbiguousNumberError(
                f"{raw.strip()!r} is ambiguous in the {number_format_locale} number format: "
                f"write {s.replace('.', '')} for a whole number, or {s.replace('.', dec_sep)} for a decimal."
            )
        return s

    dec = re.escape(dec_sep)
    plain = rf"^-?\d+({dec}\d+)?$"
    grouped = rf"^-?\d{{1,3}}({re.escape(grp_sep)}\d{{3}})+({dec}\d+)?$" if grp_sep else None
    if re.match(plain, s) or (grouped and re.match(grouped, s)):
        if grp_sep:
            s = s.replace(grp_sep, "")
        s = s.replace(dec_sep, ".")
        if is_canonical_money(s):
            return s
    raise MoneyParseError(f"Cannot parse {raw!r} as a number in the {number_format_locale} number format.")


def parse_money(raw: str | None) -> Decimal | None:
    """Parse *raw* to Decimal, accepting canonical decimal strings only.

    Returns None for None or blank input.
    Raises MoneyParseError for any non-canonical value (currency symbols,
    grouping separators, locale decimal commas, etc.).
    """
    if raw is None or not raw.strip():
        return None
    if not is_canonical_money(raw):
        raise MoneyParseError(f"Non-canonical money value: {raw!r}. Expected a plain decimal string (e.g. '1234.50').")
    return Decimal(raw.strip())


def frontend_number_formats() -> dict:
    """Separators and currency markers for the frontend's parser (generated file).

    The frontend reads frontend/src/generated/numberFormats.json instead of the
    browser's locale data, so both parsers use the same separators.
    """
    return {
        "separators": {
            locale: {"decimal": dec, "group": grp}
            for locale, (dec, grp) in sorted(_LOCALE_SEPS.items())
        },
        "currencySymbols": "".join(sorted(_CURRENCY_SYMBOLS)),
        "currencyCodes": sorted(_CURRENCY_CODES),
    }


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path

    Path(sys.argv[1]).write_text(
        json.dumps(frontend_number_formats(), indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )

"""
Canonical money parser and validator.

The canonical format for money (and numeric quantities) stored in the DB is a
plain decimal string: optional leading minus, one or more digits, optional
decimal point followed by one or more digits.  Examples: "0", "1234", "1234.50",
"-50.00".

Non-canonical values (currency symbols, grouping separators, locale decimal
commas) are rejected by parse_money and flagged by is_canonical_money.

This is the single source of truth for the backend.  The CSV import path and
the aggregation layer must both call these functions — there must be exactly one
money parser in the backend.
"""

from __future__ import annotations

import re
from decimal import Decimal

# Pattern for canonical decimal: optional minus, digits, optional fractional part.
_CANONICAL_RE = re.compile(r"^-?\d+(\.\d+)?$")

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


def is_canonical_money(raw: str) -> bool:
    """Return True iff *raw* is a canonical decimal string (e.g. '1234.50')."""
    return bool(_CANONICAL_RE.match(raw.strip()))


def parse_localized_money(raw: str | None, number_format_locale: str) -> str | None:
    """Convert a localized money string to a canonical decimal string.

    Uses *number_format_locale* (BCP 47 tag, e.g. 'de-DE') to detect decimal
    and grouping separators.  Falls back to en-US conventions for unrecognised
    locales.

    Returns the canonical decimal string (e.g. '1234.50'), or None for blank.
    Raises MoneyParseError when the value cannot be normalised.
    """
    if raw is None or not raw.strip():
        return None

    s = raw.strip()

    dec_sep, grp_sep = _LOCALE_SEPS.get(number_format_locale, (".", ","))

    # Strip explicit grouping separators only when they look like grouping.
    # This preserves canonical "1234.50" input under locales such as de-DE
    # while still interpreting the locale-ambiguous "1.000" as one thousand.
    has_decimal_sep = dec_sep != "." and dec_sep in s
    grouping_pattern = (
        rf"^-?\d{{1,3}}({re.escape(grp_sep)}\d{{3}})+"
        rf"({re.escape(dec_sep)}\d+)?$"
        if grp_sep
        else ""
    )
    if grp_sep and (has_decimal_sep or re.match(grouping_pattern, s)):
        s = s.replace(grp_sep, "")
    # Also strip common Unicode space variants used as grouping separators
    s = re.sub(r"[\s\u00a0\u202f\u2009]", "", s)

    # Convert locale decimal separator to canonical '.'
    if dec_sep != ".":
        s = s.replace(dec_sep, ".")

    if not is_canonical_money(s):
        raise MoneyParseError(f"Cannot parse {raw!r} as a number for locale {number_format_locale!r}.")

    return s


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

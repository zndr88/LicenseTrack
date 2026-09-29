"""Shared typed-number cases, also run by the frontend (numberParsingCases.test.js)."""

import json
from pathlib import Path

import pytest

from app.services.money import AmbiguousNumberError, MoneyParseError, parse_localized_money

CASES = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "number_parsing_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[f"{c['locale']}:{c['input']!r}" for c in CASES])
def test_shared_number_parsing_case(case):
    if "error" in case:
        expected_error = AmbiguousNumberError if case["error"] == "ambiguous" else MoneyParseError
        with pytest.raises(expected_error) as raised:
            parse_localized_money(case["input"], case["locale"])
        if case["error"] == "invalid":
            assert not isinstance(raised.value, AmbiguousNumberError)
    else:
        assert parse_localized_money(case["input"], case["locale"]) == case["expected"]


def test_frontend_number_formats_file_is_up_to_date():
    from app.services.money import frontend_number_formats

    path = Path(__file__).resolve().parents[3] / "frontend" / "src" / "generated" / "numberFormats.json"
    assert json.loads(path.read_text(encoding="utf-8")) == frontend_number_formats(), (
        "Run from backend/: py -3.12 -m app.services.money ../frontend/src/generated/numberFormats.json"
    )

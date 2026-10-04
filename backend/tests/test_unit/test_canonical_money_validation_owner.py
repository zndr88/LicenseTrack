from pathlib import Path

import pytest

from app.services.money import validate_canonical_money

from tests.single_owner import find_definitions


@pytest.mark.parametrize("value", [None, "", "0", "-2.50", "1234.50", " 12", 3, 2.5])
def test_validation_preserves_values_for_schema_coercion(value):
    assert validate_canonical_money(value) == value


@pytest.mark.parametrize("value", ["1,5", "1.234,50", " EUR 12", "NaN"])
def test_validation_preserves_rejection_message(value):
    with pytest.raises(ValueError) as raised:
        validate_canonical_money(value)
    assert str(raised.value) == f"Money values must be plain decimal strings (e.g. '1234.50'); got {value!r}."


def test_canonical_money_rejection_has_one_owner():
    app = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(
        app,
        r"Money values must be plain decimal strings",
        owners={"services/money.py"},
    ) == []

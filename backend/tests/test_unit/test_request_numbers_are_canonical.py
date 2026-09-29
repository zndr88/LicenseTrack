"""Every numeric text field in an API request accepts only canonical numbers.

The frontend's NumberInput converts what users type into canonical form
("1234.50"). If a form ever sends typed text as-is, the server must refuse it
rather than store or reinterpret it.
"""

import re

import pytest
from pydantic import ValidationError

from tests.test_unit.test_request_models_use_base import _request_models

NUMERIC_NAME = re.compile(r"(quantity|price|cost|total|override|amount)")
NOT_NUMERIC: set[str] = set()


def _numeric_text_fields():
    fields = []
    for model in sorted(_request_models(), key=lambda m: m.__name__):
        for name, field in model.model_fields.items():
            if not NUMERIC_NAME.search(name) or name in NOT_NUMERIC or "centre" in name:
                continue
            annotation = str(field.annotation)
            if "str" not in annotation:
                continue
            fields.append((model, name, field.alias or name))
    return fields


FIELDS = _numeric_text_fields()


@pytest.mark.parametrize("model,name,alias", FIELDS, ids=[f"{m.__name__}.{n}" for m, n, _ in FIELDS])
def test_numeric_request_field_rejects_typed_text(model, name, alias):
    with pytest.raises(ValidationError) as raised:
        model.model_validate({alias: "1,5"})
    locations = {error["loc"][0] for error in raised.value.errors()}
    assert alias in locations or name in locations, (
        f"{model.__name__}.{name} accepted '1,5'; add the canonical-number validator"
    )

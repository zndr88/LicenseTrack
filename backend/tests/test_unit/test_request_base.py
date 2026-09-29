import logging

import pytest
from pydantic import ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from app.request_context import current_request
from app.schemas.request_base import RequestModel, unknown_request_fields


class _Sample(RequestModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    po_number: str | None = None


def test_known_fields_by_name_and_alias_are_not_unknown():
    assert unknown_request_fields(_Sample, {"poNumber": "1", "po_number": "2"}) == []


def test_unknown_fields_are_listed_sorted():
    assert unknown_request_fields(_Sample, {"poNumbr": "1", "zeta": 1, "poNumber": "x"}) == ["poNumbr", "zeta"]


def test_tests_run_strict_so_unknown_fields_are_rejected():
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        _Sample.model_validate({"poNumbr": "1"})


def test_unknown_fields_are_logged_with_the_request(caplog):
    token = current_request.set("PUT /api/licenses/1")
    try:
        with caplog.at_level(logging.WARNING, logger="app.schemas.request_base"):
            with pytest.raises(ValidationError):
                _Sample.model_validate({"poNumbr": "1"})
    finally:
        current_request.reset(token)
    assert "Unknown request fields on PUT /api/licenses/1 (_Sample): poNumbr" in caplog.text

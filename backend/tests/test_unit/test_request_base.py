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


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record):
        self.messages.append(record.getMessage())


def _validate_capturing(model, data):
    """Validate *data* and return the warnings the base class logged.

    A handler on the logger itself is used (not caplog) so other tests that
    change logging propagation cannot hide the message.
    """
    logger = logging.getLogger("app.schemas.request_base")
    handler = _Capture()
    previous = (logger.disabled, logger.level)
    logger.disabled = False
    logger.setLevel(logging.WARNING)
    logger.addHandler(handler)
    try:
        try:
            model.model_validate(data)
        except ValidationError:
            pass
    finally:
        logger.removeHandler(handler)
        logger.disabled, level = previous
        logger.setLevel(level)
    return handler.messages


def test_unknown_fields_are_logged_with_the_request():
    token = current_request.set("PUT /api/licenses/1")
    try:
        messages = _validate_capturing(_Sample, {"poNumbr": "1"})
    finally:
        current_request.reset(token)
    assert messages == ["Unknown request fields on PUT /api/licenses/1 (_Sample): poNumbr"]


class _LenientSample(_Sample):
    """The production default: unknown fields are ignored (and logged)."""

    model_config = ConfigDict(extra="ignore")


def test_lenient_mode_ignores_unknown_fields_and_still_logs_them():
    token = current_request.set("POST /api/licenses")
    try:
        messages = _validate_capturing(_LenientSample, {"poNumbr": "1", "poNumber": "PO-1"})
        parsed = _LenientSample.model_validate({"poNumbr": "1", "poNumber": "PO-1"})
    finally:
        current_request.reset(token)
    assert parsed.po_number == "PO-1"
    assert not hasattr(parsed, "poNumbr")
    assert messages == ["Unknown request fields on POST /api/licenses (_LenientSample): poNumbr"]


def test_known_fields_log_nothing():
    assert _validate_capturing(_Sample, {"poNumber": "PO-1"}) == []


def test_legacy_custom_field_flag_is_consumed_not_reported():
    from app.schemas.custom_fields import CustomFieldDefinitionCreate

    messages = _validate_capturing(
        CustomFieldDefinitionCreate, {"name": "Owner", "fieldType": "text", "carryForwardOnRenewal": True}
    )
    parsed = CustomFieldDefinitionCreate.model_validate(
        {"name": "Owner", "fieldType": "text", "carryForwardOnRenewal": True}
    )
    assert messages == []
    assert parsed.renewal_behavior.value == "copy"


def test_running_migrations_does_not_silence_the_unknown_field_warning(tmp_path, monkeypatch):
    """The app migrates at startup; that must not disable loggers created earlier."""
    from alembic import command

    from app.services import backup_service

    logger = logging.getLogger("app.schemas.request_base")
    monkeypatch.setattr(logger, "disabled", False)
    command.upgrade(backup_service._alembic_config(tmp_path / "licenses.db"), "head")
    assert logger.disabled is False

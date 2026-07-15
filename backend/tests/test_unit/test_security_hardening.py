from fastapi import HTTPException
import pytest

from app.services import api_token_service
from app.services.license_write_service import validate_patch_field_input


def test_api_token_hash_uses_keyed_digest(monkeypatch):
    monkeypatch.setattr(api_token_service.settings, "JWT_SECRET", "test-signing-secret")

    digest = api_token_service.hash_api_token("lt_example-token")

    assert len(digest) == 64
    assert digest != "lt_example-token"
    assert digest == api_token_service.hash_api_token("lt_example-token")


@pytest.mark.parametrize("field", ["contactEmail", "budgetOwnerEmail"])
def test_patch_email_fields_accept_normal_addresses(field):
    validate_patch_field_input(field, "license.manager@example.com")


@pytest.mark.parametrize("value", ["missing-at.example.com", "bad @example.com", "user@example", "user@example..com"])
def test_patch_email_fields_reject_invalid_addresses(value):
    with pytest.raises(HTTPException) as exc_info:
        validate_patch_field_input("contactEmail", value)

    assert exc_info.value.status_code == 400

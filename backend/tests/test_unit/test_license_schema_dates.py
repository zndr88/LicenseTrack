from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.license import LicenseUpdate


@pytest.mark.parametrize("field", ["request_date", "purchase_date"])
def test_license_update_normalizes_blank_procurement_datetimes(field):
    parsed = LicenseUpdate.model_validate({field: ""})

    assert getattr(parsed, field) is None


@pytest.mark.parametrize("field", ["request_date", "purchase_date"])
@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("2026-05-04", datetime(2026, 5, 4)),
        ("2026-05-04T09:15:00Z", datetime.fromisoformat("2026-05-04T09:15:00+00:00")),
    ],
)
def test_license_update_accepts_optional_procurement_datetimes(field, value, expected):
    parsed = LicenseUpdate.model_validate({field: value})

    assert getattr(parsed, field) == expected


@pytest.mark.parametrize("field", ["request_date", "purchase_date"])
def test_license_update_rejects_invalid_procurement_datetimes(field):
    with pytest.raises(ValidationError):
        LicenseUpdate.model_validate({field: "not-a-date"})

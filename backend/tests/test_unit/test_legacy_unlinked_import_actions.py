import json

import pytest
from fastapi import HTTPException

from app.routes.csv_import import _load_row_parent_overrides


def test_legacy_unlinked_action_normalizes_without_parent():
    assert _load_row_parent_overrides(json.dumps([
        {"rowNumber": 12, "action": "import_legacy_unlinked"},
    ])) == {12: {"action": "import_legacy_unlinked"}}


def test_old_parent_only_override_normalizes_to_link_existing():
    assert _load_row_parent_overrides(json.dumps([
        {"rowNumber": 12, "parentLicenseId": 45},
    ])) == {12: {"action": "link_existing", "parent_license_id": 45}}


@pytest.mark.parametrize("payload", [
    [{"rowNumber": 12, "action": "unknown"}],
    [{"rowNumber": 12, "action": "link_existing"}],
    [{"rowNumber": 12, "action": "import_legacy_unlinked", "parentLicenseId": 45}],
    [{"rowNumber": 12, "action": "link_existing", "parentLicenseId": True}],
    [{"rowNumber": 12, "action": "import_legacy_unlinked"}, {"rowNumber": 12, "action": "import_legacy_unlinked"}],
])
def test_invalid_import_action_contract_returns_422(payload):
    with pytest.raises(HTTPException) as exc_info:
        _load_row_parent_overrides(json.dumps(payload))
    assert exc_info.value.status_code == 422

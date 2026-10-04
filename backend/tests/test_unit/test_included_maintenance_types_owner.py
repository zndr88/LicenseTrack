from pathlib import Path

from tests.single_owner import find_definitions


def test_importer_does_not_define_its_own_included_maintenance_types():
    app = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(
        app,
        r'_?INCLUDED_SUPPORT_PARENT_TYPES\s*=|=\s*\{"perpetual",\s*"oem",\s*"freeware"\}',
        owners={"services/license_service.py"},
    ) == []

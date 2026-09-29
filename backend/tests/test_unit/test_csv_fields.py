import json
from pathlib import Path

from app.services import csv_importer


SNAPSHOT = json.loads(
    (Path(__file__).parents[1] / "fixtures" / "csv_mapping_snapshot.json").read_text()
)


def test_registry_reproduces_the_existing_header_map():
    assert dict(sorted(csv_importer._HEADER_MAP.items())) == SNAPSHOT["header_map"]


def test_registry_reproduces_the_ignored_headers():
    assert sorted(csv_importer._IGNORED_HEADERS) == SNAPSHOT["ignored"]


def test_frontend_csv_field_file_is_up_to_date():
    from app.services.csv_fields import frontend_export_headers

    generated = json.loads(
        (Path(__file__).parents[3] / "frontend" / "src" / "generated" / "csvFields.json").read_text()
    )
    assert generated == {"exportHeaders": frontend_export_headers()}, (
        "Run: py -3.12 -m app.services.csv_fields ../frontend/src/generated/csvFields.json"
    )

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

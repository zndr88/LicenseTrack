from pathlib import Path

import pytest

from tests.single_owner import find_definitions


def test_find_definitions_reports_files_outside_the_owner(tmp_path: Path):
    (tmp_path / "owner.py").write_text("OPEN = {'a', 'b'}\n", encoding="utf-8")
    (tmp_path / "copy.py").write_text("if x in {'a', 'b'}:\n    pass\n", encoding="utf-8")
    (tmp_path / "other.py").write_text("print('a')\n", encoding="utf-8")

    found = find_definitions(tmp_path, r"\{'a', 'b'\}", owners={"owner.py"})

    assert found == ["copy.py:1"]


def test_find_definitions_is_empty_when_only_the_owner_matches(tmp_path: Path):
    (tmp_path / "owner.py").write_text("OPEN = {'a', 'b'}\n", encoding="utf-8")

    assert find_definitions(tmp_path, r"\{'a', 'b'\}", owners={"owner.py"}) == []


def test_find_definitions_rejects_an_owner_that_does_not_exist(tmp_path: Path):
    with pytest.raises(AssertionError, match="owner file missing"):
        find_definitions(tmp_path, r"x", owners={"gone.py"})

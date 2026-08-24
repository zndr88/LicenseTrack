import pytest
from fastapi import HTTPException
from app.services import storage
import app.services.storage as _storage_module


def test_save_file_bytes_writes_correct_content(tmp_path):
    content = b"PDF file contents here"
    stored_path, size = storage.save_file_bytes(content, "invoice.pdf", license_id=42, storage_base=str(tmp_path))
    full_path = tmp_path / stored_path
    assert full_path.exists()
    assert full_path.read_bytes() == content
    assert size == len(content)


def test_save_file_bytes_returns_relative_path(tmp_path):
    content = b"data"
    stored_path, _ = storage.save_file_bytes(content, "doc.pdf", license_id=7, storage_base=str(tmp_path))
    # Must be relative (no leading slash)
    assert not stored_path.startswith("/")
    assert "attachments/licenses/7/" in stored_path.replace("\\", "/")


@pytest.mark.parametrize(
    ("scope", "scope_id", "expected_directory"),
    [
        ("pending_order", 12, "attachments/procurement/pending_orders/12/"),
        ("bundle", "5f70f30c-2e1d-4b93-8af4-64141077b902", "attachments/procurement/bundles/5f70f30c-2e1d-4b93-8af4-64141077b902/"),
        ("license", 42, "attachments/procurement/licenses/42/"),
    ],
)
def test_save_procurement_document_bytes_uses_immutable_scope_directory(
    tmp_path,
    scope,
    scope_id,
    expected_directory,
):
    stored_path, size = storage.save_procurement_document_bytes(
        b"evidence",
        "invoice.pdf",
        scope,
        scope_id,
        str(tmp_path),
    )

    assert expected_directory in stored_path.replace("\\", "/")
    assert (tmp_path / stored_path).read_bytes() == b"evidence"
    assert size == len(b"evidence")


def test_save_file_bytes_sanitises_filename(tmp_path):
    content = b"data"
    stored_path, _ = storage.save_file_bytes(content, "../../etc/passwd", license_id=1, storage_base=str(tmp_path))
    full_path = tmp_path / stored_path
    assert full_path.exists()
    # The traversal attempt must not escape the base
    assert full_path.is_relative_to(tmp_path)


def test_save_file_bytes_uses_default_storage_path(tmp_path, monkeypatch):
    """Test that save_file_bytes uses settings.STORAGE_PATH when storage_base=None."""
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    content = b"default path test"
    stored_path, size = storage.save_file_bytes(content, "file.pdf", license_id=99)
    full_path = tmp_path / stored_path
    assert full_path.exists()
    assert full_path.read_bytes() == content
    assert size == len(content)


def test_save_file_bytes_raises_on_path_traversal(tmp_path, monkeypatch):
    """Test that save_file_bytes raises HTTPException when path traversal is detected."""
    # Make _license_dir return a path outside the storage base
    evil_dir = tmp_path.parent / "outside"
    evil_dir.mkdir(exist_ok=True)
    monkeypatch.setattr(_storage_module, "_license_dir", lambda *a, **kw: evil_dir)

    with pytest.raises(HTTPException) as exc_info:
        storage.save_file_bytes(b"data", "file.pdf", license_id=1, storage_base=str(tmp_path))
    assert exc_info.value.status_code == 400

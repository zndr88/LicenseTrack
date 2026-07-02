"""
Unit tests for app.services.storage (get_file_path, delete_file).

Uses tmp_path for a real filesystem root and monkeypatch to redirect
settings.STORAGE_PATH away from the dev environment.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import HTTPException

import app.services.storage as _storage_module
from app.services.storage import delete_file, get_file_path, resolve_storage_path, validate_upload


# ---------------------------------------------------------------------------
# 5a — get_file_path returns the correct absolute path
# ---------------------------------------------------------------------------

def test_get_file_path_correct(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    result = get_file_path("documents/1/somefile.pdf")

    assert result == tmp_path / "documents/1/somefile.pdf"


# ---------------------------------------------------------------------------
# 5b — get_file_path rejects path traversal attempts
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_path", [
    "../outside.txt",
    "documents/../../etc/passwd",
])
def test_get_file_path_rejects_traversal(tmp_path, monkeypatch, bad_path):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    with pytest.raises(HTTPException) as exc_info:
        get_file_path(bad_path)

    assert exc_info.value.status_code == 400


def test_get_file_path_rejects_absolute_path_outside_base(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    outside = tmp_path.parent / "outside.pdf"

    with pytest.raises(HTTPException) as exc_info:
        get_file_path(str(outside))

    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# 5c — delete_file removes an existing file
# ---------------------------------------------------------------------------

def test_delete_file_removes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    target = tmp_path / "documents" / "1" / "test.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("hello")

    delete_file("documents/1/test.txt")

    assert not target.exists()


# ---------------------------------------------------------------------------
# 5d — delete_file is silent when the file does not exist
# ---------------------------------------------------------------------------

def test_delete_file_silent_on_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    delete_file("documents/999/nonexistent.txt")   # must not raise


def test_delete_file_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    with pytest.raises(HTTPException) as exc_info:
        delete_file("../outside.txt")

    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# resolve_storage_path — DB-aware storage path resolver
# ---------------------------------------------------------------------------

def _make_db_mock(gs):
    """Return an AsyncMock db where execute(...).scalar_one_or_none() returns gs."""
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = gs
    db = AsyncMock()
    db.execute.return_value = execute_result
    return db


@pytest.mark.asyncio
async def test_resolve_storage_path_custom_valid(tmp_path):
    """Returns custom path string when GlobalSettings.storage_path is a real dir."""
    gs = MagicMock()
    gs.storage_path = str(tmp_path)
    db = _make_db_mock(gs)

    result = await resolve_storage_path(db)
    assert result == str(tmp_path)


@pytest.mark.asyncio
async def test_resolve_storage_path_custom_missing():
    """Raises HTTP 503 when the custom path does not exist on disk."""
    from fastapi import HTTPException
    gs = MagicMock()
    gs.storage_path = "/nonexistent/path/xyz_licensetrack_test"
    db = _make_db_mock(gs)

    with pytest.raises(HTTPException) as exc_info:
        await resolve_storage_path(db)
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_resolve_storage_path_default_valid(tmp_path, monkeypatch):
    """Returns None when no custom path is set and the default STORAGE_PATH exists."""
    gs = MagicMock()
    gs.storage_path = ""
    db = _make_db_mock(gs)
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    result = await resolve_storage_path(db)
    assert result is None


@pytest.mark.asyncio
async def test_resolve_storage_path_default_missing(monkeypatch):
    """Raises HTTP 503 when no custom path and default STORAGE_PATH does not exist."""
    from fastapi import HTTPException
    gs = MagicMock()
    gs.storage_path = ""
    db = _make_db_mock(gs)
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", "/nonexistent/default_xyz")

    with pytest.raises(HTTPException) as exc_info:
        await resolve_storage_path(db)
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_resolve_storage_path_no_global_settings_row(tmp_path, monkeypatch):
    """Falls through to default STORAGE_PATH when no GlobalSettings row exists."""
    db = _make_db_mock(None)
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))

    result = await resolve_storage_path(db)
    assert result is None


# ---------------------------------------------------------------------------
# validate_upload — shared upload guard
# ---------------------------------------------------------------------------

def _make_upload_file(filename: str) -> MagicMock:
    f = MagicMock()
    f.filename = filename
    return f


def test_validate_upload_passes_for_valid_file(monkeypatch):
    """Accepts a small file with an allowed extension — no exception raised."""
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf,.docx")
    validate_upload(_make_upload_file("doc.pdf"), b"x" * 100)  # must not raise


def test_validate_upload_rejects_oversized_file(monkeypatch):
    """Raises HTTP 422 when file exceeds MAX_UPLOAD_SIZE_MB."""
    from fastapi import HTTPException
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 1)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf")
    content = b"x" * (1 * 1024 * 1024 + 1)
    with pytest.raises(HTTPException) as exc_info:
        validate_upload(_make_upload_file("big.pdf"), content)
    assert exc_info.value.status_code == 422
    assert "maximum allowed size" in exc_info.value.detail


def test_validate_upload_rejects_disallowed_extension(monkeypatch):
    """Raises HTTP 422 when file extension is not in ALLOWED_UPLOAD_EXTENSIONS."""
    from fastapi import HTTPException
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf,.docx")
    with pytest.raises(HTTPException) as exc_info:
        validate_upload(_make_upload_file("script.exe"), b"data")
    assert exc_info.value.status_code == 422
    assert ".exe" in exc_info.value.detail


def test_validate_upload_accepts_allowed_mime(monkeypatch):
    """When allowed_mimes is provided, an explicitly allowed MIME type passes."""
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf")
    f = _make_upload_file("doc.pdf")
    f.content_type = "application/pdf"
    validate_upload(f, b"data", allowed_mimes=frozenset({"application/pdf"}))  # must not raise


def test_validate_upload_rejects_disallowed_mime(monkeypatch):
    """When allowed_mimes is provided, an unrecognised MIME type raises 422."""
    from fastapi import HTTPException
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf")
    f = _make_upload_file("doc.pdf")
    f.content_type = "application/x-executable"
    with pytest.raises(HTTPException) as exc_info:
        validate_upload(f, b"data", allowed_mimes=frozenset({"application/pdf"}))
    assert exc_info.value.status_code == 422
    assert "application/x-executable" in exc_info.value.detail


def test_validate_upload_skips_mime_check_when_not_provided(monkeypatch):
    """When allowed_mimes is None (default), any MIME type is accepted."""
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf")
    f = _make_upload_file("doc.pdf")
    f.content_type = "application/x-executable"  # would be rejected if allowed_mimes was set
    validate_upload(f, b"data")  # must not raise


def test_validate_upload_extension_error_includes_accepted_types(monkeypatch):
    """Extension rejection message includes the list of accepted types."""
    from fastapi import HTTPException
    monkeypatch.setattr(_storage_module.settings, "MAX_UPLOAD_SIZE_MB", 10)
    monkeypatch.setattr(_storage_module.settings, "ALLOWED_UPLOAD_EXTENSIONS", ".pdf,.docx")
    with pytest.raises(HTTPException) as exc_info:
        validate_upload(_make_upload_file("bad.exe"), b"data")
    assert "Accepted types" in exc_info.value.detail

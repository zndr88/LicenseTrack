"""
Integration tests for backup/restore routes.

Tests the HTTP contract for POST /api/backup/trigger,
GET /api/backup/list, and POST /api/backup/restore.

Critical patches applied per test:
- get_db_path  → redirected to a real temp SQLite file
- os.kill       → no-op (prevents SIGTERM from killing the test process)
- create_backup / restore_backup → replaced in error-path tests to verify
  A2 error sanitisation (generic message, not str(exc))
"""

import io
import sqlite3
import time
import zipfile

import bcrypt
import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile
from starlette.requests import Request

import app.routes.backup as backup_module
from app.config import settings
from app.models.settings import GlobalSettings
from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_sqlite_db(path) -> None:
    """Create a minimal empty SQLite database file at *path*."""
    conn = sqlite3.connect(str(path))
    conn.close()


def _make_zip_with_db() -> bytes:
    """Return in-memory zip bytes containing a fake .db entry."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("licenses.db", b"fake db content")
    buf.seek(0)
    return buf.read()


def _make_zip_without_db() -> bytes:
    """Return in-memory zip bytes that contain no .db entry."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "not a database")
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# 3a — POST /api/backup/trigger succeeds and returns a zip filename
# ---------------------------------------------------------------------------

async def test_trigger_backup_success(db_session, test_app, auth_headers, tmp_path, monkeypatch):
    # Real SQLite file for create_backup to snapshot
    real_db = tmp_path / "test.db"
    _make_sqlite_db(real_db)
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: real_db)

    # GlobalSettings row pointing backup output to a temp dir
    backup_dir = tmp_path / "backups"
    gs = GlobalSettings(id=1, backup_location=str(backup_dir))
    db_session.add(gs)
    await db_session.commit()

    resp = await test_app.post("/api/backup/trigger", headers=auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "filename" in data
    assert data["filename"].endswith(".zip")


# ---------------------------------------------------------------------------
# 3b — Trigger error returns generic message, not str(exc) — validates A2
# ---------------------------------------------------------------------------

async def test_trigger_backup_sanitises_error(db_session, test_app, auth_headers, monkeypatch):
    def _fail(location):
        raise RuntimeError("internal secret detail")

    monkeypatch.setattr("app.services.backup_service.create_backup", _fail)

    # GlobalSettings row (backup_location value doesn't matter — create_backup is patched)
    gs = GlobalSettings(id=1, backup_location="/tmp/backups")
    db_session.add(gs)
    await db_session.commit()

    resp = await test_app.post("/api/backup/trigger", headers=auth_headers)

    assert resp.status_code == 500
    assert "internal secret detail" not in resp.text


# ---------------------------------------------------------------------------
# 3c — GET /api/backup/list returns [] when backup dir does not exist
# ---------------------------------------------------------------------------

async def test_list_backups_empty(db_session, test_app, auth_headers, tmp_path):
    # Point backup_location at a directory that does not exist
    gs = GlobalSettings(id=1, backup_location=str(tmp_path / "nonexistent_backups"))
    db_session.add(gs)
    await db_session.commit()

    resp = await test_app.get("/api/backup/list", headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# 3d — GET /api/backup/list returns entries for existing zip files
# ---------------------------------------------------------------------------

async def test_list_backups_returns_entries(db_session, test_app, auth_headers, tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    # Create two dummy backup zips using the expected filename pattern
    for i in range(2):
        f = backup_dir / f"license_lifecycle_backup_2024010{i + 1}_000000.zip"
        f.write_bytes(b"fake zip content")
        # Spread mtime so ordering is stable
        mtime = time.time() + i * 10
        import os
        os.utime(str(f), (mtime, mtime))

    gs = GlobalSettings(id=1, backup_location=str(backup_dir))
    db_session.add(gs)
    await db_session.commit()

    resp = await test_app.get("/api/backup/list", headers=auth_headers)

    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2
    for entry in entries:
        assert "filename" in entry
        assert "size_bytes" in entry
        assert "created_at" in entry


# ---------------------------------------------------------------------------
# 3e — Non-admin (editor) is rejected from backup routes
# ---------------------------------------------------------------------------

async def test_backup_rejects_non_admin(db_session, test_app):
    password = "editorpass123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()
    editor = User(
        username="editor1",
        email="editor1@test.local",
        hashed_password=hashed,
        role=UserRole.editor,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(editor)
    await db_session.commit()

    login_resp = await test_app.post(
        "/api/auth/login",
        json={"username": "editor1", "password": password},
    )
    assert login_resp.status_code == 200
    editor_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    resp = await test_app.post("/api/backup/trigger", headers=editor_headers)

    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 3f — Restore rejects a non-zip file (422)
# ---------------------------------------------------------------------------

async def test_restore_rejects_non_zip(test_app, auth_headers, monkeypatch):
    monkeypatch.setattr(backup_module.os, "kill", lambda pid, sig: None)

    files = {"file": ("test.txt", b"not a zip file", "text/plain")}
    resp = await test_app.post("/api/backup/restore", files=files, headers=auth_headers)

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 3g — Restore rejects a zip that contains no .db entry (422)
# ---------------------------------------------------------------------------

async def test_restore_rejects_zip_without_db(test_app, auth_headers, monkeypatch):
    monkeypatch.setattr(backup_module.os, "kill", lambda pid, sig: None)

    files = {"file": ("backup.zip", _make_zip_without_db(), "application/zip")}
    resp = await test_app.post("/api/backup/restore", files=files, headers=auth_headers)

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 3h — Restore error returns generic message, not str(exc) — validates A2
# ---------------------------------------------------------------------------

async def test_restore_sanitises_error(test_app, auth_headers, monkeypatch):
    monkeypatch.setattr(backup_module.os, "kill", lambda pid, sig: None)

    def _fail(path):
        raise RuntimeError("internal restore detail")

    monkeypatch.setattr("app.services.backup_service.restore_backup", _fail)

    files = {"file": ("backup.zip", _make_zip_with_db(), "application/zip")}
    resp = await test_app.post("/api/backup/restore", files=files, headers=auth_headers)

    assert resp.status_code == 500
    assert "internal restore detail" not in resp.text


# ---------------------------------------------------------------------------
# F10 — Content-Length pre-check: oversized header must be rejected with 413
# ---------------------------------------------------------------------------

async def test_backup_restore_rejects_oversized_content_length(
    test_app, auth_headers
):
    oversized_cl = str(settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024 + 1)

    resp = await test_app.post(
        "/api/backup/restore",
        content=b"small body",
        headers={**auth_headers, "content-length": oversized_cl},
    )

    assert resp.status_code == 413


async def test_backup_restore_rejects_oversized_body_after_read(
    db_session, monkeypatch
):
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 0)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/backup/restore",
            "headers": [(b"content-length", b"0")],
            "client": ("testclient", 50000),
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )
    upload = UploadFile(
        file=io.BytesIO(_make_zip_with_db()),
        filename="backup.zip",
    )
    admin = User(username="admin", email="admin@test.local", hashed_password="x", role=UserRole.admin)

    with pytest.raises(HTTPException) as exc_info:
        await backup_module.restore_backup(upload, request, db_session, admin)

    assert exc_info.value.status_code == 413

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
import json
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
        with zipfile.ZipFile(f, "w") as zf:
            zf.writestr("licenses.db", b"database placeholder")
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

    resp = await test_app.post(
        "/api/backup/restore-server",
        json={"filename": "license_lifecycle_backup_test.zip"},
        headers=editor_headers,
    )
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
# 3i — Restore success returns before scheduling process termination
# ---------------------------------------------------------------------------

async def test_restore_success_can_skip_process_restart(test_app, auth_headers, monkeypatch):
    restored_paths = []
    killed = []

    def _restore(path):
        restored_paths.append(path)

    def _kill(pid, sig):
        killed.append((pid, sig))

    monkeypatch.setattr(settings, "RESTART_AFTER_RESTORE", False)
    monkeypatch.setattr("app.services.backup_service.restore_backup", _restore)
    monkeypatch.setattr(backup_module.os, "kill", _kill)

    files = {"file": ("backup.zip", _make_zip_with_db(), "application/zip")}
    resp = await test_app.post("/api/backup/restore", files=files, headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "status": "restore_completed",
        "restart_scheduled": False,
        "archive_type": "database_backup",
        "restored_documents": False,
    }
    assert len(restored_paths) == 1
    assert killed == []


async def test_restore_success_returns_before_scheduled_restart(test_app, auth_headers, monkeypatch):
    restored_paths = []
    killed = []

    def _restore(path):
        restored_paths.append(path)

    def _kill(pid, sig):
        killed.append((pid, sig))

    monkeypatch.setattr(settings, "RESTART_AFTER_RESTORE", True)
    monkeypatch.setattr("app.services.backup_service.restore_backup", _restore)
    monkeypatch.setattr(backup_module.os, "kill", _kill)

    files = {"file": ("backup.zip", _make_zip_with_db(), "application/zip")}
    resp = await test_app.post("/api/backup/restore", files=files, headers=auth_headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "status": "restore_initiated",
        "restart_scheduled": True,
        "archive_type": "database_backup",
        "restored_documents": False,
    }
    assert len(restored_paths) == 1
    assert killed == [(backup_module.os.getpid(), backup_module.signal.SIGTERM)]


async def test_list_backups_includes_typed_portfolio_recovery_archive(
    db_session,
    test_app,
    auth_headers,
    tmp_path,
):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    recovery = backup_dir / "license_lifecycle_pre_portfolio_reset_20260724_010203_000001.zip"
    with zipfile.ZipFile(recovery, "w") as zf:
        zf.writestr("database/licenses.db", b"database placeholder")
        zf.writestr(
            "portfolio_reset_manifest.json",
            json.dumps({"archive_type": "portfolio_reset_recovery"}),
        )
        zf.writestr("storage/documents/1/eula.pdf", b"eula")
    db_session.add(GlobalSettings(id=1, backup_location=str(backup_dir)))
    await db_session.commit()

    response = await test_app.get("/api/backup/list", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == [
        {
            "filename": recovery.name,
            "size_bytes": recovery.stat().st_size,
            "created_at": recovery.stat().st_mtime,
            "archive_type": "portfolio_reset_recovery",
            "includes_documents": True,
        }
    ]


async def test_restore_server_uses_exact_allow_listed_archive(
    db_session,
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    archive = backup_dir / "license_lifecycle_backup_20260724_010203.zip"
    archive.write_bytes(_make_zip_with_db())
    db_session.add(GlobalSettings(id=1, backup_location=str(backup_dir)))
    await db_session.commit()
    restored = []

    def fake_restore(path, *, storage_location, safety_archive):
        restored.append((path, storage_location, safety_archive))
        return {"archive_type": "database_backup", "restored_documents": False}

    monkeypatch.setattr(settings, "RESTART_AFTER_RESTORE", False)
    monkeypatch.setattr(backup_module, "restore_backup_archive", fake_restore)

    response = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": archive.name},
    )

    assert response.status_code == 200, response.text
    assert response.json()["archive_type"] == "database_backup"
    assert restored == [(archive, settings.STORAGE_PATH, None)]


async def test_restore_server_rejects_paths_and_unlisted_files(
    db_session,
    test_app,
    auth_headers,
    tmp_path,
):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    outside = tmp_path / "license_lifecycle_backup_outside.zip"
    outside.write_bytes(_make_zip_with_db())
    symlink = backup_dir / "license_lifecycle_backup_symlink.zip"
    symlink.symlink_to(outside)
    unlisted = backup_dir / "manually_named_backup.zip"
    unlisted.write_bytes(_make_zip_with_db())
    db_session.add(GlobalSettings(id=1, backup_location=str(backup_dir)))
    await db_session.commit()

    traversal = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": "../outside.zip"},
    )
    absolute = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": str(outside.resolve())},
    )
    missing = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": "license_lifecycle_backup_missing.zip"},
    )
    symlinked = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": symlink.name},
    )
    not_enumerated = await test_app.post(
        "/api/backup/restore-server",
        headers=auth_headers,
        json={"filename": unlisted.name},
    )

    assert traversal.status_code == 422
    assert absolute.status_code == 422
    assert missing.status_code == 404
    assert symlinked.status_code == 404
    assert not_enumerated.status_code == 404


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

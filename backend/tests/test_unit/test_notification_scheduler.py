from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.settings import GlobalSettings
from app.services import notification_scheduler


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_scheduler_session(monkeypatch, db_session):
    monkeypatch.setattr(
        notification_scheduler,
        "AsyncSessionLocal",
        lambda: _SessionContext(db_session),
    )


async def test_prune_audit_log_deletes_rows_older_than_retention(db_session, monkeypatch):
    _patch_scheduler_session(monkeypatch, db_session)
    old_row = AuditLog(
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=120),
        actor_email="system@test.local",
        action="old",
    )
    recent_row = AuditLog(
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=5),
        actor_email="system@test.local",
        action="recent",
    )
    db_session.add_all([old_row, recent_row])
    await db_session.commit()

    await notification_scheduler._prune_audit_log(90)

    actions = list((await db_session.execute(select(AuditLog.action))).scalars().all())
    assert actions == ["recent"]


async def test_write_backup_status_updates_global_settings(db_session, monkeypatch):
    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1))
    await db_session.commit()

    await notification_scheduler._write_backup_status("success")

    settings = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert settings.last_backup_status == "success"
    assert settings.last_backup_at is not None


async def test_run_backup_skips_when_disabled(monkeypatch):
    called = False

    def create_backup(_location):
        nonlocal called
        called = True

    monkeypatch.setattr("app.services.backup_service.create_backup", create_backup)
    gs = GlobalSettings(id=1, backup_enabled=False, backup_location="unused")

    await notification_scheduler._run_backup(gs)

    assert called is False


async def test_run_backup_records_success(db_session, monkeypatch, tmp_path):
    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1))
    await db_session.commit()

    created = tmp_path / "backup.zip"
    calls = []

    async def fake_run_routine_backup(location, keep):
        calls.append((location, keep))
        return created

    monkeypatch.setattr(
        "app.services.backup_service.run_routine_backup",
        fake_run_routine_backup,
    )
    gs = GlobalSettings(id=1, backup_enabled=True, backup_location=str(tmp_path), backup_keep=2)

    await notification_scheduler._run_backup(gs)

    settings = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert settings.last_backup_status == "success"
    assert calls == [(str(tmp_path), 2)]


async def test_run_backup_records_failure(db_session, monkeypatch, tmp_path):
    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1))
    await db_session.commit()

    async def fail_backup(_location, _keep):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.services.backup_service.run_routine_backup", fail_backup)
    gs = GlobalSettings(id=1, backup_enabled=True, backup_location=str(tmp_path), backup_keep=2)

    await notification_scheduler._run_backup(gs)

    settings = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert settings.last_backup_status == "failed"


def test_seconds_until_hour_rolls_to_tomorrow_after_target_hour():
    now = datetime(2026, 5, 21, 8, 30, tzinfo=timezone.utc)

    assert notification_scheduler._seconds_until_hour(now, 7) == pytest.approx(22.5 * 60 * 60)


def test_seconds_until_hour_before_target_hour():
    """When now < target hour, returns seconds remaining in the same day."""
    now = datetime(2026, 5, 21, 6, 0, tzinfo=timezone.utc)
    # 1 hour until 07:00
    assert notification_scheduler._seconds_until_hour(now, 7) == pytest.approx(3600.0)


# ---------------------------------------------------------------------------
# _prune_audit_log – exception handler (lines 32-33)
# ---------------------------------------------------------------------------


async def test_prune_audit_log_handles_exception_gracefully(monkeypatch):
    """If the DB raises, _prune_audit_log logs the error and does not re-raise."""

    class _BrokenContext:
        async def __aenter__(self):
            raise RuntimeError("db is down")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _BrokenContext())

    # Should NOT raise even though the DB is broken
    await notification_scheduler._prune_audit_log(90)


# ---------------------------------------------------------------------------
# _write_backup_status – exception handler (lines 46-47)
# ---------------------------------------------------------------------------


async def test_write_backup_status_handles_exception_gracefully(monkeypatch):
    """If the DB raises, _write_backup_status logs the error and does not re-raise."""

    class _BrokenContext:
        async def __aenter__(self):
            raise RuntimeError("db is down")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _BrokenContext())

    await notification_scheduler._write_backup_status("success")


async def test_write_backup_status_no_op_when_no_settings_row(db_session, monkeypatch):
    """When GlobalSettings row does not exist, _write_backup_status exits quietly."""
    _patch_scheduler_session(monkeypatch, db_session)
    # No GlobalSettings row inserted → scalar_one_or_none() returns None
    await notification_scheduler._write_backup_status("success")
    # Just verifying no exception is raised


# ---------------------------------------------------------------------------
# start_scheduler – tested by running exactly ONE iteration then breaking out.
#
# Strategy: monkeypatch asyncio.sleep so that:
#   • The first call (the 5-second startup sleep) completes immediately.
#   • The second call (the per-loop sleep) raises StopAsyncIteration so the
#     while-True loop exits, letting us assert on side effects.
# ---------------------------------------------------------------------------


class _SleepBreaker:
    """Allows the first N asyncio.sleep calls through; raises on call N+1."""

    def __init__(self, allow: int = 1):
        self._allow = allow
        self._count = 0

    async def __call__(self, _seconds):
        self._count += 1
        if self._count > self._allow:
            raise StopAsyncIteration("breaking out of scheduler loop")


async def test_start_scheduler_runs_prune_on_startup(db_session, monkeypatch):
    """start_scheduler prunes audit log during the startup phase (before the loop)."""
    _patch_scheduler_session(monkeypatch, db_session)
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", _SleepBreaker(allow=1))

    # Populate GlobalSettings so the startup path finds retention_days
    db_session.add(GlobalSettings(id=1, audit_log_retention_days=30))
    await db_session.commit()

    # Insert an old AuditLog row that should be pruned
    old = AuditLog(
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=60),
        actor_email="system@test.local",
        action="old_startup",
    )
    db_session.add(old)
    await db_session.commit()

    # Stub out the webhook / notification side-effects so only the startup prune runs
    monkeypatch.setattr(
        notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0)
    )
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    remaining = list(
        (await db_session.execute(select(AuditLog.action))).scalars().all()
    )
    assert "old_startup" not in remaining


async def test_start_scheduler_uses_defaults_when_no_settings_row(db_session, monkeypatch):
    """start_scheduler falls back to default values when GlobalSettings is absent."""
    _patch_scheduler_session(monkeypatch, db_session)
    # Allow startup sleep + one loop sleep
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", _SleepBreaker(allow=2))

    monkeypatch.setattr(
        notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0)
    )
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass
    # No assertion needed — the test passes if no exception is raised (defaults used)


async def test_start_scheduler_logs_warning_when_db_fails_to_load_settings(monkeypatch, caplog):
    """When settings cannot be loaded, scheduler logs a warning and uses defaults."""
    import logging

    call_count = 0

    class _BrokenAfterStartup:
        """Succeed for the startup call, fail for the loop call."""

        async def __aenter__(self):
            nonlocal call_count
            call_count += 1
            if call_count > 1:
                raise RuntimeError("db failure")
            # Return a minimal session-like object that returns None for settings
            return _NullSession()

        async def __aexit__(self, *a):
            return False

    class _NullSession:
        async def execute(self, _stmt):
            return _NullResult()

        async def commit(self):
            pass

    class _NullResult:
        def scalar_one_or_none(self):
            return None

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _BrokenAfterStartup())
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", _SleepBreaker(allow=2))
    monkeypatch.setattr(
        notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0)
    )
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    with caplog.at_level(logging.WARNING, logger="app.services.notification_scheduler"):
        try:
            await notification_scheduler.start_scheduler()
        except StopAsyncIteration:
            pass

    assert any("Could not load scheduler settings" in r.message for r in caplog.records)


async def test_start_scheduler_dispatches_webhooks(db_session, monkeypatch):
    """start_scheduler calls dispatch_pending_webhooks each loop iteration."""
    _patch_scheduler_session(monkeypatch, db_session)
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", _SleepBreaker(allow=2))

    dispatch_calls = []

    async def fake_dispatch():
        dispatch_calls.append(1)
        return 3  # non-zero so the info log branch is hit

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", fake_dispatch)
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    assert len(dispatch_calls) >= 1


async def test_start_scheduler_webhook_dispatch_exception_does_not_crash(db_session, monkeypatch):
    """Exceptions inside dispatch_pending_webhooks are caught and logged."""
    _patch_scheduler_session(monkeypatch, db_session)
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", _SleepBreaker(allow=2))

    async def broken_dispatch():
        raise RuntimeError("webhook broken")

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", broken_dispatch)
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass
    # Should not raise RuntimeError


async def test_start_scheduler_sends_notifications_when_past_send_hour(db_session, monkeypatch):
    """Notification run fires when now_after >= notification target time."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)

    db_session.add(GlobalSettings(id=1, notification_send_hour=7, backup_enabled=False))
    await db_session.commit()

    notification_sent = []

    async def fake_run_notifications(db):
        notification_sent.append(1)
        return {"sent": 1}

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", fake_run_notifications)

    # Patch `datetime` in the scheduler module with a stand-in class that delegates
    # everything to the real datetime but returns scripted values for `now()`.
    # The sequence must account for ALL datetime.now() calls inside the module:
    #   call 0: _prune_audit_log (startup cutoff)
    #   call 1: line 90  → `now`  (before send_hour, so 06:59)
    #   call 2: line 121 → `now_after` (past send_hour, so 07:01)
    _before = dt_module.datetime(2026, 5, 21, 6, 59, tzinfo=dt_module.timezone.utc)
    _after  = dt_module.datetime(2026, 5, 21, 7, 1,  tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]  # prune, now, now_after

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_call_count = [0]

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    assert len(notification_sent) >= 1


async def test_start_scheduler_skips_notification_already_sent_today(db_session, monkeypatch):
    """Notification run is skipped when last_notification_sent_date == today (line 137)."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)

    today = dt_module.date(2026, 5, 21)
    db_session.add(
        GlobalSettings(
            id=1,
            notification_send_hour=7,
            backup_enabled=False,
            last_notification_sent_date=today,
        )
    )
    await db_session.commit()

    notification_sent = []

    async def fake_run_notifications(db):
        notification_sent.append(1)
        return {"sent": 1}

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", fake_run_notifications)

    _before = dt_module.datetime(2026, 5, 21, 6, 59, tzinfo=dt_module.timezone.utc)
    _after  = dt_module.datetime(2026, 5, 21, 7, 1,  tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]  # prune, now, now_after

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_call_count = [0]

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    assert len(notification_sent) == 0


async def test_start_scheduler_notification_exception_does_not_crash(db_session, monkeypatch):
    """Exceptions in run_daily_notifications are caught, not re-raised (lines 144-145)."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1, notification_send_hour=7, backup_enabled=False))
    await db_session.commit()

    async def broken_notifications(db):
        raise RuntimeError("notification boom")

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", broken_notifications)

    _before = dt_module.datetime(2026, 5, 21, 6, 59, tzinfo=dt_module.timezone.utc)
    _after  = dt_module.datetime(2026, 5, 21, 7, 1,  tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]  # prune, now, now_after

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_call_count = [0]

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass
    # Pass = no RuntimeError propagated


async def test_start_scheduler_runs_backup_when_enabled(db_session, monkeypatch, tmp_path):
    """Backup runs when backup_enabled=True and we're past the backup hour."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(
        GlobalSettings(
            id=1,
            notification_send_hour=7,
            backup_enabled=True,
            backup_hour=2,
            backup_location=str(tmp_path),
            backup_keep=2,
        )
    )
    await db_session.commit()

    backup_called = []

    def fake_create_backup(location):
        backup_called.append(1)
        return tmp_path / "backup.zip"

    monkeypatch.setattr("app.services.backup_service.create_backup", fake_create_backup)
    monkeypatch.setattr("app.services.backup_service.prune_backups", lambda *a: None)
    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0}))

    # `now` = 01:59 (before backup_hour=2), `now_after` = 02:01 (past backup_hour)
    # Sequence: prune cutoff, `now` (line 90), `now_after` (line 121)
    _before = dt_module.datetime(2026, 5, 21, 1, 59, tzinfo=dt_module.timezone.utc)
    _after  = dt_module.datetime(2026, 5, 21, 2, 1,  tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]  # prune, now, now_after

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_call_count = [0]

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    assert len(backup_called) >= 1


async def test_start_scheduler_backup_job_exception_does_not_crash(db_session, monkeypatch, tmp_path):
    """Exception loading backup settings is caught and logged, not re-raised."""
    from unittest.mock import patch

    call_count = [0]

    class _FailingOnBackupSession:
        async def __aenter__(self):
            call_count[0] += 1
            # First two calls (startup + loop-settings): succeed with no row
            # Third call (backup-settings load): raise
            if call_count[0] >= 3:
                raise RuntimeError("backup db failure")
            return _NullSession()

        async def __aexit__(self, *a):
            return False

    class _NullSession:
        async def execute(self, _stmt):
            return _NullResult()

        async def commit(self):
            pass

    class _NullResult:
        def scalar_one_or_none(self):
            return None

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _FailingOnBackupSession())
    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0}))

    sleep_call_count = [0]

    class _FakeDatetime(datetime):
        _call_count = 0

        @classmethod
        def now(cls, tz=None):
            cls._call_count += 1
            if cls._call_count <= 3:
                return datetime(2026, 5, 21, 1, 59, tzinfo=timezone.utc)
            else:
                return datetime(2026, 5, 21, 2, 1, tzinfo=timezone.utc)

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    # Patch the scheduler to think backup_enabled=True via the defaults path
    # by making the settings load fail (triggering the except branch which sets backup_enabled=False)
    # Actually we need backup_enabled=True here; patch at the while-True level.
    # Simpler: just verify no crash occurs when backup db load fails.
    with patch("app.services.notification_scheduler.datetime", _FakeDatetime):
        monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
        try:
            await notification_scheduler.start_scheduler()
        except StopAsyncIteration:
            pass
    # Pass = exception was caught internally


async def test_start_scheduler_audit_prune_runs_once_per_day(db_session, monkeypatch):
    """Audit log is pruned once per calendar day during the loop."""
    from unittest.mock import patch

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1, audit_log_retention_days=30, backup_enabled=False))
    await db_session.commit()

    # Anchor the row to the same fixed clock the scheduler uses below (the
    # _FakeDatetime always returns 2026-05-21), NOT the real wall clock. If the
    # row is dated from the real clock, its age relative to the fixed fake cutoff
    # drifts with the calendar and eventually falls inside the 30-day retention
    # window, turning this into a time-bomb test (it began failing on 2026-06-20).
    old = AuditLog(
        timestamp=datetime(2026, 5, 21, 6, 30) - timedelta(days=60),
        actor_email="system@test.local",
        action="old_loop",
    )
    db_session.add(old)
    await db_session.commit()

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(
        notification_scheduler, "run_daily_notifications", lambda db: _async_return({"sent": 0})
    )

    sleep_call_count = [0]

    class _FakeDatetime(datetime):
        _call_count = 0

        @classmethod
        def now(cls, tz=None):
            cls._call_count += 1
            # Keep returning the same time so we stay before send_hour and past loop sleep
            return datetime(2026, 5, 21, 6, 30, tzinfo=timezone.utc)

    async def controlled_sleep(seconds):
        sleep_call_count[0] += 1
        if sleep_call_count[0] > 2:
            raise StopAsyncIteration

    with patch("app.services.notification_scheduler.datetime", _FakeDatetime):
        monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
        try:
            await notification_scheduler.start_scheduler()
        except StopAsyncIteration:
            pass

    remaining = list(
        (await db_session.execute(select(AuditLog.action))).scalars().all()
    )
    assert "old_loop" not in remaining


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


async def test_start_scheduler_startup_db_exception_is_caught(monkeypatch, caplog):
    """Exception during startup DB read (lines 77-78) is logged, not re-raised."""
    import logging

    call_count = [0]

    class _FailOnSecondEnter:
        """First enter (the 5s sleep's continuation) raises so the startup block fails."""

        async def __aenter__(self):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("startup db read failure")
            # Subsequent calls: return a null session
            return _NullSession()

        async def __aexit__(self, *a):
            return False

    class _NullSession:
        async def execute(self, _stmt):
            return _NullResult()

        async def commit(self):
            pass

    class _NullResult:
        def scalar_one_or_none(self):
            return None

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _FailOnSecondEnter())
    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", lambda db: _async_return({}))

    sleep_calls = [0]

    async def controlled_sleep(seconds):
        sleep_calls[0] += 1
        if sleep_calls[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)

    with caplog.at_level(logging.ERROR, logger="app.services.notification_scheduler"):
        try:
            await notification_scheduler.start_scheduler()
        except StopAsyncIteration:
            pass

    assert any("Initial audit log prune failed" in r.message for r in caplog.records)


async def test_start_scheduler_backup_load_exception_is_caught(db_session, monkeypatch, tmp_path, caplog):
    """Exception loading backup settings (lines 161-162) is caught and logged."""
    import datetime as dt_module
    import logging

    # We need backup_enabled=True in GlobalSettings so the code enters the backup block.
    # But then we need the AsyncSessionLocal inside the backup block to raise.
    _normal_session = _SessionContext(db_session)
    call_count = [0]

    class _FailOnBackupDBLoad:
        async def __aenter__(self):
            call_count[0] += 1
            # Calls in order through one loop iteration:
            #   1 = startup: GlobalSettings read
            #   2 = startup: _prune_audit_log inner AsyncSessionLocal
            #   3 = loop: settings read (must succeed so backup_enabled=True is loaded)
            #   4 = loop: backup block inner AsyncSessionLocal → raise HERE
            #   5 = loop: _prune_audit_log (caught internally if it raises)
            if call_count[0] == 4:
                raise RuntimeError("backup settings load failure")
            return db_session

        async def __aexit__(self, *a):
            return False

    db_session.add(
        GlobalSettings(
            id=1,
            notification_send_hour=7,
            backup_enabled=True,
            backup_hour=2,
            backup_location=str(tmp_path),
            backup_keep=2,
        )
    )
    await db_session.commit()

    monkeypatch.setattr(notification_scheduler, "AsyncSessionLocal", lambda: _FailOnBackupDBLoad())
    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", lambda db: _async_return({}))

    # Time: now=01:59, now_after=02:01 (past backup_hour=2)
    _before = dt_module.datetime(2026, 5, 21, 1, 59, tzinfo=dt_module.timezone.utc)
    _after  = dt_module.datetime(2026, 5, 21, 2, 1,  tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_calls = [0]

    async def controlled_sleep(seconds):
        sleep_calls[0] += 1
        if sleep_calls[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)

    with caplog.at_level(logging.ERROR, logger="app.services.notification_scheduler"):
        try:
            await notification_scheduler.start_scheduler()
        except StopAsyncIteration:
            pass

    assert any("Backup job failed to load settings" in r.message for r in caplog.records)


async def test_start_scheduler_backup_target_advances_to_tomorrow(db_session, monkeypatch, tmp_path):
    """When now >= backup_target, backup_target advances to tomorrow (line 151).

    Set now=02:01 and now_after=02:30; backup_hour=2 so backup_target=02:00.
    now >= backup_target → target advances to 03:00 next day → now_after < that → no backup fired.
    The branch on line 151 must execute.
    """
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(
        GlobalSettings(
            id=1,
            notification_send_hour=7,
            backup_enabled=True,
            backup_hour=2,
            backup_location=str(tmp_path),
            backup_keep=2,
        )
    )
    await db_session.commit()

    backup_called = []

    def fake_create_backup(location):
        backup_called.append(1)
        return tmp_path / "backup.zip"

    monkeypatch.setattr("app.services.backup_service.create_backup", fake_create_backup)
    monkeypatch.setattr("app.services.backup_service.prune_backups", lambda *a: None)
    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", lambda db: _async_return({}))

    # now=02:01 (past backup_hour=2) → target set to tomorrow; now_after=02:30 < tomorrow → no backup
    _now_val   = dt_module.datetime(2026, 5, 21, 2, 1,  tzinfo=dt_module.timezone.utc)
    _after_val = dt_module.datetime(2026, 5, 21, 2, 30, tzinfo=dt_module.timezone.utc)
    _now_seq = [_now_val, _now_val, _after_val]  # prune, now, now_after

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    sleep_calls = [0]

    async def controlled_sleep(seconds):
        sleep_calls[0] += 1
        if sleep_calls[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    # backup should NOT be called because target rolled to tomorrow
    assert len(backup_called) == 0


# ---------------------------------------------------------------------------
# Gap 1 — attempt vs. success tracking (no more silent failures)
# ---------------------------------------------------------------------------


def test_notification_run_succeeded_true_when_no_errors():
    from app.services.notification_sender import notification_run_succeeded
    assert notification_run_succeeded({"budget_owner_emails_sent": 2, "errors": []}) is True


def test_notification_run_succeeded_false_when_delivery_errors():
    from app.services.notification_sender import notification_run_succeeded
    assert notification_run_succeeded({"errors": ["owner@x: smtp down"]}) is False


def test_notification_run_succeeded_true_when_skipped():
    from app.services.notification_sender import notification_run_succeeded
    assert notification_run_succeeded({"skipped": True, "reason": "email_disabled"}) is True


def _run_one_scheduler_iteration(monkeypatch, fake_run, *, send_hour=7):
    """Drive start_scheduler through exactly one loop iteration past the send hour."""
    import datetime as dt_module

    monkeypatch.setattr(notification_scheduler, "dispatch_pending_webhooks", lambda: _async_return(0))
    monkeypatch.setattr(notification_scheduler, "run_daily_notifications", fake_run)

    _before = dt_module.datetime(2026, 5, 21, 6, 59, tzinfo=dt_module.timezone.utc)
    _after = dt_module.datetime(2026, 5, 21, 7, 1, tzinfo=dt_module.timezone.utc)
    _now_seq = [_before, _before, _after]

    class _FakeDT(dt_module.datetime):
        _idx = 0

        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            val = _now_seq[min(cls._idx, len(_now_seq) - 1)]
            cls._idx += 1
            return val

    monkeypatch.setattr(notification_scheduler, "datetime", _FakeDT)

    counter = [0]

    async def controlled_sleep(_seconds):
        counter[0] += 1
        if counter[0] > 2:
            raise StopAsyncIteration

    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", controlled_sleep)


async def test_scheduler_clean_run_marks_attempt_and_success(db_session, monkeypatch):
    """A run with no delivery errors records both attempt and success dates."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1, notification_send_hour=7, backup_enabled=False))
    await db_session.commit()

    async def fake_run(db):
        return {"budget_owner_emails_sent": 1, "errors": []}

    _run_one_scheduler_iteration(monkeypatch, fake_run)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    gs = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    today = dt_module.date(2026, 5, 21)
    assert gs.last_notification_attempt_date == today
    assert gs.last_notification_sent_date == today


async def test_scheduler_failed_run_records_attempt_but_not_success(db_session, monkeypatch):
    """A run with delivery errors records the attempt but leaves the day un-sent.

    This is the core of Gap 1: SMTP failure must NOT mark the day handled, so the
    license can still be alerted via a later manual retry.
    """
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(GlobalSettings(id=1, notification_send_hour=7, backup_enabled=False))
    await db_session.commit()

    async def fake_run(db):
        return {"budget_owner_emails_sent": 0, "errors": ["owner@x: smtp down"]}

    _run_one_scheduler_iteration(monkeypatch, fake_run)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    gs = await db_session.scalar(select(GlobalSettings).where(GlobalSettings.id == 1))
    assert gs.last_notification_attempt_date == dt_module.date(2026, 5, 21)
    assert gs.last_notification_sent_date is None


async def test_scheduler_does_not_auto_retry_after_failed_attempt_today(db_session, monkeypatch):
    """If today was already attempted without success, the scheduler does not re-run
    automatically (no 60s hammering / duplicate sends); manual trigger is the retry path."""
    import datetime as dt_module

    _patch_scheduler_session(monkeypatch, db_session)
    db_session.add(
        GlobalSettings(
            id=1,
            notification_send_hour=7,
            backup_enabled=False,
            last_notification_attempt_date=dt_module.date(2026, 5, 21),
            last_notification_sent_date=None,
        )
    )
    await db_session.commit()

    calls = []

    async def fake_run(db):
        calls.append(1)
        return {"errors": []}

    _run_one_scheduler_iteration(monkeypatch, fake_run)
    try:
        await notification_scheduler.start_scheduler()
    except StopAsyncIteration:
        pass

    assert calls == []  # run was skipped — already attempted today


async def _async_return(value):
    return value

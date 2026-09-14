"""Upgrade/downgrade coverage for individually revocable sessions."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from app.models.user import User, UserRole, AuthProvider

from app.config import settings


def test_human_session_migration_round_trip(tmp_path, monkeypatch):
    database = tmp_path / "sessions.sqlite"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    command.upgrade(config, "d2b3c4d5e6f7")
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with Session(engine) as session:
            session.add(
                User(
                    username="migration-user",
                    email="migration@example.com",
                    hashed_password="not-used",
                    role=UserRole.viewer,
                    auth_provider=AuthProvider.local,
                    is_active=True,
                    must_change_password=False,
                )
            )
            session.commit()
        with engine.connect() as connection:
            before = connection.execute(text("SELECT COUNT(*) FROM users")).scalar()
        command.upgrade(config, "e3c4d5e6f7a8")
        assert "human_sessions" in inspect(engine).get_table_names()
        assert {column["name"] for column in inspect(engine).get_columns("human_sessions")} == {
            "id",
            "user_id",
            "security_version",
            "issued_at",
            "expires_at",
        }
        command.downgrade(config, "d2b3c4d5e6f7")
        assert "human_sessions" not in inspect(engine).get_table_names()
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM users")).scalar() == before
    finally:
        engine.dispose()

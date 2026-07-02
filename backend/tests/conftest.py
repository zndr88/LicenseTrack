import os

# Set test environment variables before any app imports so that pydantic-settings
# picks them up when constructing the Settings singleton in app.config.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest
import bcrypt
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db, enable_sqlite_foreign_keys

# Import all models so SQLAlchemy's mapper registry is fully populated before
# Base.metadata.create_all is called.  MUST appear before `from app.main
# import app` because `import app.models` binds the name `app` in this module
# to the package; `from app.main import app` then rebinds it to the FastAPI
# instance as intended.
import app.models  # noqa: F401 — side-effect import registers every ORM model

from app.main import app

from app.models.user import User, UserRole

_TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(autouse=True)
def _reset_login_rate_limiter():
    """Clear the in-memory login throttle counters around every test so failed-
    login state from one test cannot leak into another (the counters are
    module-level singletons on app.routes.auth)."""
    import app.routes.auth as _auth

    _auth._login_attempts_by_user.clear()
    _auth._login_attempts_by_ip.clear()
    yield
    _auth._login_attempts_by_user.clear()
    _auth._login_attempts_by_ip.clear()


@pytest.fixture
async def db_session():
    """Async SQLAlchemy session backed by a fresh in-memory SQLite database.

    Tables are created before the test and dropped after, giving each test
    function complete isolation from every other test.
    """
    engine = create_async_engine(_TEST_DB_URL, echo=False)
    enable_sqlite_foreign_keys(engine.sync_engine)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        # Disable FK enforcement for teardown so that SQLAlchemy's drop_all
        # table-ordering logic (which uses CASCADE SET NULL on self-referential
        # FK columns) does not trip the ck_license_maintenance_has_parent CHECK
        # constraint.  The engine is disposed immediately after, so there is no
        # risk of leaving enforcement off for a live session.
        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.fixture
async def test_app(db_session):
    """httpx.AsyncClient wired to the real FastAPI app via ASGITransport.

    The get_db dependency is overridden to use the in-memory test session.
    The production lifespan (Alembic migration, scheduler) is NOT triggered —
    httpx's ASGITransport only sends HTTP-scope requests to the ASGI app and
    never issues the lifespan-scope that would invoke startup/shutdown hooks.
    """
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def auth_headers(db_session, test_app):
    """Authorization header dict for a freshly-created admin user.

    Creates the user directly in the test database, then obtains a real JWT
    by calling POST /api/auth/login. This validates authentication as a side
    effect of the fixture setup.
    """
    password = "testpassword123"
    hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()

    user = User(
        username="testadmin",
        email="testadmin@test.local",
        hashed_password=hashed,
        role=UserRole.admin,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()

    response = await test_app.post(
        "/api/auth/login",
        json={"username": "testadmin", "password": password},
    )
    assert response.status_code == 200, f"auth_headers login failed: {response.text}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

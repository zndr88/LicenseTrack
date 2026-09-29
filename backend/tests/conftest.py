import os

# Set test environment variables before any app imports so that pydantic-settings
# picks them up when constructing the Settings singleton in app.config.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault("STRICT_REQUEST_FIELDS", "true")

import pytest
import bcrypt
from httpx import AsyncClient, ASGITransport
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
from app.routes import backup as backup_module
from app.models.license import License as _GuardLicense
from app.models.pending_order import PendingOrder as _GuardPendingOrder
from app.models.sourcing import SourcingItem as _GuardSourcingItem
from app.models.sourcing import SourcingStatus as _GuardSourcingStatus
from app.request_context import current_request
from app.services.procurement_identity import normalize_po_number
from sqlalchemy import event
from sqlalchemy import inspect as _sa_inspect
from sqlalchemy.orm import Session
from sqlalchemy.orm.base import NO_VALUE

_TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


def _loaded(obj, attribute):
    """The attribute's value if it is already loaded, else NO_VALUE (never triggers a lazy load)."""
    return _sa_inspect(obj).attrs[attribute].loaded_value


def _line_problem(obj, po_key, *, is_new):
    """Why *obj*'s PO line does not match its PO number, or None when it does (or cannot be told)."""
    line_id = _loaded(obj, "po_line_id")
    line = _loaded(obj, "po_line")
    line = None if line is NO_VALUE else line
    if line_id is NO_VALUE and line is None and not is_new:
        return None  # expired or never loaded: cannot tell without a query
    has_line = line is not None or line_id not in (None, NO_VALUE)
    if po_key and not has_line:
        return "has a PO number but no PO line"
    if po_key and line is not None and line.po_key != po_key:
        return f"holds a PO line issued on another PO ({line.po_key!r})"
    if not po_key and has_line:
        return "has no PO number but still holds a PO line"
    return None


def _unnumbered_records(session):
    """Records written in this commit whose PO line does not match their PO number."""
    new = set(session.new)
    written = list(session.new) + list(session.dirty)
    items = [obj for obj in written if isinstance(obj, _GuardSourcingItem)]
    for obj in written:
        if isinstance(obj, _GuardPendingOrder):
            items.extend(item for item in (_loaded(obj, "items") or []) if item not in items)
    problems = []
    for obj in written:
        if isinstance(obj, _GuardLicense):
            po_number = _loaded(obj, "po_number")
            if po_number is NO_VALUE:
                continue
            problem = _line_problem(obj, normalize_po_number(po_number), is_new=obj in new)
            if problem:
                problems.append(f"License {obj.id} ({po_number!r}) {problem}")
    for item in items:
        order = _loaded(item, "pending_order")
        if order in (None, NO_VALUE) or _loaded(item, "status") == _GuardSourcingStatus.cancelled:
            continue
        order_po = _loaded(order, "po_number")
        if order_po is NO_VALUE:
            continue
        problem = _line_problem(item, normalize_po_number(order_po), is_new=item in new)
        if problem:
            problems.append(f"SourcingItem {item.id} on {order_po!r} {problem}")
    return problems


@event.listens_for(Session, "before_commit")
def _every_po_has_a_line(session):
    """Test-only invariant: inside an API request, every record written keeps a PO line that matches its PO number."""
    if current_request.get() == "(no request)":
        return  # fixtures and direct service tests may build rows by hand
    problems = _unnumbered_records(session)
    assert not problems, (
        f"{current_request.get()} committed records whose PO line does not match their PO number "
        f"(a writer skipped po_line_service): {'; '.join(problems)}"
    )


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

    # The database lives only in this per-test engine's connection pool, so
    # disposing the engine discards every table with it. An explicit drop_all is
    # redundant here (and previously needed a FK-off dance to avoid tripping the
    # self-referential maintenance CHECK constraint during table ordering).
    await engine.dispose()


@pytest.fixture
async def test_app(db_session, monkeypatch):
    """httpx.AsyncClient wired to the real FastAPI app via ASGITransport.

    The get_db dependency is overridden to use the in-memory test session.
    The production lifespan (Alembic migration, scheduler) is NOT triggered —
    httpx's ASGITransport only sends HTTP-scope requests to the ASGI app and
    never issues the lifespan-scope that would invoke startup/shutdown hooks.
    """
    async def override_get_db():
        yield db_session

    session_factory = async_sessionmaker(
        bind=db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    monkeypatch.setattr(backup_module, "AsyncSessionLocal", session_factory)
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-LicenseTrack-Request": "1"},
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

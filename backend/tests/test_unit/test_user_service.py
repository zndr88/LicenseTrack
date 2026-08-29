"""Unit tests for app.services.user_service — user domain invariants."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.settings import UserSettings
from app.models.user import AuthProvider, User
from app.schemas.user import UserCreate
from app.services.user_service import (
    INHERITED_SETTING_FIELDS,
    apply_user_update,
    build_inherited_user_settings,
    ensure_local_admin_invariant,
    reject_break_glass_change,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_user(**overrides) -> User:
    defaults = {
        "id": 1,
        "username": "alice",
        "email": "alice@example.com",
        "hashed_password": "hashed",
        "role": "admin",
        "auth_provider": AuthProvider.local,
        "is_active": True,
        "is_break_glass_admin": False,
        "allow_downloads": False,
        "must_change_password": False,
    }
    defaults.update(overrides)
    return User(**defaults)


def test_local_user_schema_requires_password():
    with pytest.raises(ValidationError, match="Password is required for local users"):
        UserCreate(
            username="local-user",
            email="local-user@example.com",
            auth_provider=AuthProvider.local,
        )


# ---------------------------------------------------------------------------
# reject_break_glass_change
# ---------------------------------------------------------------------------

def test_reject_break_glass_change_is_noop_for_regular_user():
    user = make_user(is_break_glass_admin=False)
    reject_break_glass_change(
        user,
        new_role="viewer",
        new_auth_provider=AuthProvider.oidc,
        new_is_active=False,
    )


def test_reject_break_glass_change_blocks_role_demotion():
    user = make_user(is_break_glass_admin=True)
    with pytest.raises(HTTPException) as exc:
        reject_break_glass_change(
            user,
            new_role="viewer",
            new_auth_provider=AuthProvider.local,
            new_is_active=True,
        )
    assert exc.value.status_code == 400
    assert "admin" in exc.value.detail.lower()


def test_reject_break_glass_change_blocks_provider_change():
    user = make_user(is_break_glass_admin=True)
    with pytest.raises(HTTPException) as exc:
        reject_break_glass_change(
            user,
            new_role="admin",
            new_auth_provider=AuthProvider.oidc,
            new_is_active=True,
        )
    assert exc.value.status_code == 400


def test_reject_break_glass_change_blocks_deactivation():
    user = make_user(is_break_glass_admin=True)
    with pytest.raises(HTTPException) as exc:
        reject_break_glass_change(
            user,
            new_role="admin",
            new_auth_provider=AuthProvider.local,
            new_is_active=False,
        )
    assert exc.value.status_code == 400


def test_reject_break_glass_change_blocks_username_change():
    user = make_user(is_break_glass_admin=True, username="break_glass")
    with pytest.raises(HTTPException) as exc:
        reject_break_glass_change(
            user,
            new_role="admin",
            new_auth_provider=AuthProvider.local,
            new_is_active=True,
            new_username="renamed",
        )
    assert exc.value.status_code == 400


def test_reject_break_glass_change_allows_same_state():
    user = make_user(is_break_glass_admin=True, username="break_glass")
    reject_break_glass_change(
        user,
        new_role="admin",
        new_auth_provider=AuthProvider.local,
        new_is_active=True,
        new_username="break_glass",
    )


# ---------------------------------------------------------------------------
# ensure_local_admin_invariant
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ensure_local_admin_invariant_raises_when_last_admin(db_session):
    user = make_user(id=99, role="admin", auth_provider=AuthProvider.local, is_active=True)
    db_session.add(user)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await ensure_local_admin_invariant(
            db_session,
            target_user=user,
            new_role="viewer",
            new_auth_provider=AuthProvider.local,
            new_is_active=True,
        )
    assert exc.value.status_code == 400
    assert "local admin" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_ensure_local_admin_invariant_allows_when_other_admin_exists(db_session):
    other = make_user(id=1, username="alice", email="alice@example.com", role="admin", auth_provider=AuthProvider.local, is_active=True)
    target = make_user(id=2, username="bob", email="bob@example.com", role="admin", auth_provider=AuthProvider.local, is_active=True)
    db_session.add(other)
    db_session.add(target)
    await db_session.flush()

    await ensure_local_admin_invariant(
        db_session,
        target_user=target,
        new_role="viewer",
        new_auth_provider=AuthProvider.local,
        new_is_active=True,
    )


@pytest.mark.asyncio
async def test_ensure_local_admin_invariant_allows_target_remaining_admin(db_session):
    user = make_user(id=5, role="admin", auth_provider=AuthProvider.local, is_active=True)
    db_session.add(user)
    await db_session.flush()

    await ensure_local_admin_invariant(
        db_session,
        target_user=user,
        new_role="admin",
        new_auth_provider=AuthProvider.local,
        new_is_active=True,
    )


# ---------------------------------------------------------------------------
# apply_user_update
# ---------------------------------------------------------------------------

def test_apply_user_update_oidc_sets_unusable_password():
    user = make_user(auth_provider=AuthProvider.local, hashed_password="old_hash", must_change_password=True)
    apply_user_update(
        user,
        username="alice",
        email="alice@example.com",
        role="admin",
        is_active=True,
        allow_downloads=False,
        auth_provider=AuthProvider.oidc,
        password=None,
        min_password_length=12,
    )
    assert user.hashed_password != "old_hash"
    assert user.must_change_password is False
    assert user.auth_provider == AuthProvider.oidc


def test_apply_user_update_local_hashes_valid_password():
    user = make_user(auth_provider=AuthProvider.local, hashed_password="old_hash")
    apply_user_update(
        user,
        username="alice",
        email="alice@example.com",
        role="admin",
        is_active=True,
        allow_downloads=False,
        auth_provider=AuthProvider.local,
        password="a-valid-password-123",
        min_password_length=12,
    )
    assert user.hashed_password != "old_hash"
    assert user.must_change_password is False


def test_apply_user_update_local_short_password_raises_422():
    user = make_user()
    with pytest.raises(HTTPException) as exc:
        apply_user_update(
            user,
            username="alice",
            email="alice@example.com",
            role="admin",
            is_active=True,
            allow_downloads=False,
            auth_provider=AuthProvider.local,
            password="short",
            min_password_length=12,
        )
    assert exc.value.status_code == 422
    assert "12" in exc.value.detail


def test_apply_user_update_local_no_password_leaves_hash_unchanged():
    user = make_user(auth_provider=AuthProvider.local, hashed_password="existing_hash")
    apply_user_update(
        user,
        username="alice",
        email="alice@example.com",
        role="admin",
        is_active=True,
        allow_downloads=False,
        auth_provider=AuthProvider.local,
        password=None,
        min_password_length=12,
    )
    assert user.hashed_password == "existing_hash"


# ---------------------------------------------------------------------------
# build_inherited_user_settings
# ---------------------------------------------------------------------------

def test_build_inherited_user_settings_copies_regional_fields():
    admin_settings = UserSettings(
        user_id=1,
        theme="dark",
        display_currency="GBP",
        number_format_locale="en-GB",
        ui_size="large",
        date_format="YYYY-MM-DD",
        time_format="12h",
        time_zone="Europe/London",
    )

    new_settings = build_inherited_user_settings(user_id=42, source=admin_settings)

    assert new_settings.user_id == 42
    for field in INHERITED_SETTING_FIELDS:
        assert getattr(new_settings, field) == getattr(admin_settings, field)


def test_build_inherited_user_settings_leaves_layout_at_defaults():
    admin_settings = UserSettings(
        user_id=1,
        theme="dark",
        saved_views=[{"name": "Admin view"}],
        column_order=["a", "b", "c"],
        sidebar_collapsed=True,
    )

    new_settings = build_inherited_user_settings(user_id=42, source=admin_settings)

    # Personal layout state is NOT inherited.
    assert new_settings.saved_views != admin_settings.saved_views
    assert new_settings.column_order != admin_settings.column_order
    assert new_settings.sidebar_collapsed != admin_settings.sidebar_collapsed


def test_build_inherited_user_settings_none_source_keeps_defaults():
    new_settings = build_inherited_user_settings(user_id=42, source=None)

    assert new_settings.user_id == 42
    # A None source leaves regional fields unset so model defaults apply.
    assert new_settings.theme is None

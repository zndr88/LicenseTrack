"""
User domain invariants.

These functions encode business rules for user management:
  - Break-glass admin protection
  - Active local admin invariant (at least one must always exist)
  - Applying validated updates to a User ORM object
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth
from app.models.contract import Contract, ContractDocument
from app.models.document import Document, ProcurementDocument
from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.settings import UserSettings
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.user import AuthProvider, User
from app.models.user_department_access import UserDepartmentAccess
from app.services.reference_data_service import resolve_department_assignment_names

# Regional / display preferences a newly created user inherits from the admin
# who created them. Personal layout state (saved views, column order, visible
# columns, sidebar) is intentionally excluded and left at defaults.
INHERITED_SETTING_FIELDS = (
    "theme",
    "display_currency",
    "number_format_locale",
    "ui_size",
    "date_format",
    "time_format",
    "time_zone",
)


@dataclass(frozen=True)
class DepartmentAccessUpdate:
    user: User
    before: list[str]
    after: list[str]


def build_inherited_user_settings(
    *,
    user_id: int,
    source: UserSettings | None,
) -> UserSettings:
    """Build a UserSettings row for a new user, inheriting regional/display
    preferences from ``source`` (typically the creating admin's settings).

    When ``source`` is None the new row keeps model defaults.
    """
    settings = UserSettings(user_id=user_id)
    if source is not None:
        for field in INHERITED_SETTING_FIELDS:
            setattr(settings, field, getattr(source, field))
    return settings


async def count_active_local_admins(
    db: AsyncSession,
    *,
    exclude_user_id: int | None = None,
) -> int:
    """Return the count of active local admins, optionally excluding one user."""
    stmt = select(func.count(User.id)).where(
        User.is_active.is_(True),
        User.role == "admin",
        User.auth_provider == AuthProvider.local,
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return int((await db.scalar(stmt)) or 0)


async def ensure_local_admin_invariant(
    db: AsyncSession,
    *,
    target_user: User,
    new_role: str,
    new_auth_provider: AuthProvider,
    new_is_active: bool,
) -> None:
    """Raise HTTP 400 if applying the proposed changes would leave zero active local admins."""
    target_remains_active_local_admin = (
        new_is_active and new_role == "admin" and new_auth_provider == AuthProvider.local
    )
    if target_remains_active_local_admin:
        return

    other_local_admins = await count_active_local_admins(db, exclude_user_id=target_user.id)
    if other_local_admins <= 0:
        raise HTTPException(
            status_code=400,
            detail="At least one active local admin must always remain available",
        )


def reject_break_glass_change(
    target_user: User,
    *,
    new_role: str,
    new_auth_provider: AuthProvider,
    new_is_active: bool,
    new_username: str | None = None,
) -> None:
    """Raise HTTP 400 if the proposed change would alter the break-glass admin account."""
    if not target_user.is_break_glass_admin:
        return
    if new_auth_provider != AuthProvider.local:
        raise HTTPException(status_code=400, detail="Break-glass admin must remain a local account")
    if new_role != "admin":
        raise HTTPException(status_code=400, detail="Break-glass admin must remain an admin")
    if not new_is_active:
        raise HTTPException(status_code=400, detail="Break-glass admin cannot be disabled")
    if new_username is not None and new_username != target_user.username:
        raise HTTPException(status_code=400, detail="Break-glass admin username cannot be changed")


def apply_user_update(
    user: User,
    *,
    username: str,
    email: str,
    role: str,
    is_active: bool,
    allow_downloads: bool,
    auth_provider: AuthProvider,
    password: str | None,
    min_password_length: int,
) -> None:
    """Apply validated fields onto the ORM User object.

    Handles password hashing and OIDC password invalidation. Raises HTTP 422
    if a local password is provided but too short.
    """
    old_auth_provider = user.auth_provider
    user.username = username
    user.email = email
    user.role = role
    user.is_active = is_active
    user.allow_downloads = allow_downloads
    user.auth_provider = auth_provider

    if auth_provider != old_auth_provider:
        user.oidc_issuer = None
        user.oidc_subject = None

    if auth_provider == AuthProvider.oidc:
        user.hashed_password = auth.hash_password(secrets.token_urlsafe(32))
        user.must_change_password = False
    elif password:  # None or empty string means "leave existing password unchanged"
        if len(password) < min_password_length:
            raise HTTPException(
                status_code=422,
                detail=f"Password must be at least {min_password_length} characters",
            )
        user.hashed_password = auth.hash_password(password)
        user.must_change_password = False


def bump_security_version(user: User) -> None:
    """Invalidate all previously issued human-session tokens for a user."""
    user.security_version = int(user.security_version or 0) + 1


async def delete_user_record(
    db: AsyncSession,
    user_id: int,
    *,
    current_user_id: int,
) -> str:
    """Delete a user while preserving non-cascading historical references."""
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_break_glass_admin:
        raise HTTPException(status_code=400, detail="Break-glass admin cannot be deleted")

    await ensure_local_admin_invariant(
        db,
        target_user=user,
        new_role=user.role,
        new_auth_provider=user.auth_provider,
        new_is_active=False,
    )

    await db.execute(update(Contract).where(Contract.created_by == user_id).values(created_by=None))
    await db.execute(update(ContractDocument).where(ContractDocument.created_by == user_id).values(created_by=None))
    await db.execute(update(Document).where(Document.uploaded_by == user_id).values(uploaded_by=None))
    await db.execute(
        update(ProcurementDocument).where(ProcurementDocument.uploaded_by == user_id).values(uploaded_by=None)
    )
    await db.execute(update(License).where(License.created_by == user_id).values(created_by=None))
    await db.execute(update(SourcingRequest).where(SourcingRequest.created_by == user_id).values(created_by=None))
    await db.execute(
        update(SourcingQuoteDocument).where(SourcingQuoteDocument.uploaded_by == user_id).values(uploaded_by=None)
    )
    await db.execute(update(SourcingItem).where(SourcingItem.created_by == user_id).values(created_by=None))
    await db.execute(update(PendingOrder).where(PendingOrder.created_by == user_id).values(created_by=None))
    await db.execute(delete(UserSettings).where(UserSettings.user_id == user_id))

    label = user.email
    await db.delete(user)
    return label


async def replace_user_department_access(
    db: AsyncSession,
    user_id: int,
    departments: list[str],
) -> DepartmentAccessUpdate:
    """Replace one user's department scope and invalidate existing sessions."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    before_result = await db.execute(
        select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == user_id)
        .order_by(UserDepartmentAccess.department)
    )
    before = sorted(row[0] for row in before_result.all())
    current_access_result = await db.execute(
        select(UserDepartmentAccess.cost_centre_id).where(UserDepartmentAccess.user_id == user_id)
    )
    current_access_ids = {row[0] for row in current_access_result.all() if row[0] is not None}
    cost_centres = await resolve_department_assignment_names(
        db,
        departments,
        currently_assigned_ids=current_access_ids,
    )
    after = [cost_centre.name for cost_centre in cost_centres]

    await db.execute(delete(UserDepartmentAccess).where(UserDepartmentAccess.user_id == user_id))
    db.add_all(
        UserDepartmentAccess(
            user_id=user_id,
            department=cost_centre.name,
            cost_centre_id=cost_centre.id,
        )
        for cost_centre in cost_centres
    )
    bump_security_version(user)
    return DepartmentAccessUpdate(user=user, before=before, after=after)

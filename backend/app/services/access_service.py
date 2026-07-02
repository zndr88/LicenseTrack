from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract
from app.models.user_department_access import UserDepartmentAccess
from app.models.license import License
from app.models.user import User


def is_viewer(user: User) -> bool:
    return getattr(user.role, "value", user.role) == "viewer"


def can_download_documents(user: User) -> bool:
    """Return whether *user* may download stored documents."""
    return not is_viewer(user) or bool(getattr(user, "allow_downloads", True))


async def get_viewer_departments(user_id: int, db: AsyncSession) -> list[str]:
    """
    Returns the list of assigned departments for a viewer.
    Returns None for admin/editor callers — callers must check role first.
    An empty list means the viewer has no departments assigned (sees zero records).
    """
    result = await db.execute(
        select(UserDepartmentAccess.department)
        .where(UserDepartmentAccess.user_id == user_id)
    )
    return [row[0] for row in result.all()]


def apply_department_filter(query, departments: list[str] | None):
    """
    Apply cost_centre scoping to a License query.
    - departments=None → no filter (admin/editor path)
    - departments=[]   → filter to nothing (viewer with no assignments)
    - departments=[..] → filter to cost_centre IN (departments)
    """
    if departments is None:
        return query
    if len(departments) == 0:
        return query.where(False)
    return query.where(License.cost_centre.in_(departments))


async def get_user_departments_for_scope(user: User, db: AsyncSession) -> list[str] | None:
    """Return viewer departments, or None for roles with unrestricted read scope."""
    if not is_viewer(user):
        return None
    return await get_viewer_departments(user.id, db)


async def can_view_license(user: User, license_obj: License, db: AsyncSession) -> bool:
    """Return whether *user* may read *license_obj* under department scoping."""
    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return True
    return bool(license_obj.cost_centre and license_obj.cost_centre in departments)


async def can_view_contract(user: User, contract: Contract, db: AsyncSession) -> bool:
    """Return whether *user* may read *contract* under linked-license department scoping."""
    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return True
    if not departments:
        return False

    result = await db.execute(
        select(License.id).where(
            License.contract_number == contract.contract_number,
            License.cost_centre.in_(departments),
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None

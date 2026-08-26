from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract
from app.models.user_department_access import UserDepartmentAccess
from app.models.license import License
from app.models.user import User
from app.services.contract_identity_service import license_contract_match


def is_viewer(user: User) -> bool:
    return getattr(user.role, "value", user.role) == "viewer"


def can_download_documents(user: User) -> bool:
    """Return whether *user* may download stored documents."""
    return not is_viewer(user) or bool(getattr(user, "allow_downloads", True))


async def get_viewer_departments(user_id: int, db: AsyncSession) -> list[int]:
    """
    Returns the canonical cost-centre IDs assigned to a viewer.
    Returns None for admin/editor callers - callers must check role first.
    An empty list means the viewer has no departments assigned (sees zero records).
    """
    result = await db.execute(
        select(UserDepartmentAccess.cost_centre_id).where(UserDepartmentAccess.user_id == user_id)
    )
    return [row[0] for row in result.all() if row[0] is not None]


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
    return query.where(License.cost_centre_id.in_(departments))


async def get_user_departments_for_scope(user: User, db: AsyncSession) -> list[int] | None:
    """Return viewer departments, or None for roles with unrestricted read scope."""
    if not is_viewer(user):
        return None
    return await get_viewer_departments(user.id, db)


async def can_view_license(user: User, license_obj: License, db: AsyncSession) -> bool:
    """Return whether *user* may read *license_obj* under department scoping."""
    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return True
    return bool(license_obj.cost_centre_id and license_obj.cost_centre_id in departments)


async def can_view_contract(user: User, contract: Contract, db: AsyncSession) -> bool:
    """Return whether *user* may read *contract* under linked-license department scoping."""
    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return True
    if not departments:
        return False

    linked = select(License.id).where(license_contract_match(contract))
    total = await db.scalar(select(func.count()).select_from(linked.subquery())) or 0
    if not total:
        return False
    out_of_scope = await db.scalar(
        select(func.count())
        .select_from(
            linked.where(
                License.cost_centre_id.is_(None) | ~License.cost_centre_id.in_(departments)
            ).subquery()
        )
    ) or 0
    return out_of_scope == 0


async def can_view_procurement_document(user: User, licenses: list[License], db: AsyncSession) -> bool:
    """Require every license covered by shared evidence to be in viewer scope."""
    departments = await get_user_departments_for_scope(user, db)
    if departments is None:
        return True
    if not licenses:
        return False
    return all(
        license_obj.cost_centre_id is not None and license_obj.cost_centre_id in departments
        for license_obj in licenses
    )

"""
Seed script for first-run system records.

Creates the break-glass admin user, GlobalSettings row, and default admin
UserSettings. It does not create sample licenses or demo procurement data.

Usage:
    cd backend
    python -m app.seed
"""

import asyncio
import logging

from sqlalchemy import select

from app import auth
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import AuthProvider, GlobalSettings, User, UserRole, UserSettings

log = logging.getLogger(__name__)


def _hash_password(plain: str) -> str:
    return auth.hash_password(plain)


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        existing_admin = await session.scalar(select(User).where(User.username == "admin"))
        if existing_admin is not None:
            log.info("Database already seeded - skipping.")
            print("Database already seeded - nothing to do.")
            return

        admin = User(
            username="admin",
            email="admin@localhost",
            hashed_password=_hash_password(settings.ADMIN_PASSWORD),
            auth_provider=AuthProvider.local,
            role=UserRole.admin,
            is_active=True,
            is_break_glass_admin=True,
            must_change_password=True,
        )
        session.add(admin)
        await session.flush()

        global_settings = GlobalSettings(
            id=1,
            mandatory_fields={
                "invoice": True,
                "eula": False,
                "entitlement": True,
                "purchaseOrder": False,
                "quote": False,
                "startDate": True,
                "endDate": True,
                "contractNumber": True,
                "poNumber": True,
                "invoiceNumber": False,
                "contactEmail": False,
                "costCentre": False,
                "budgetOwnerEmail": False,
            },
            session_timeout=30,
            password_min_length=12,
        )
        session.add(global_settings)
        session.add(UserSettings(user_id=admin.id))

        await session.commit()

        print("Seed complete: admin user, GlobalSettings, and admin UserSettings created.")
        log.info("Seed complete.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed())

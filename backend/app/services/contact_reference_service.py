"""Read-only contact suggestions derived from saved license contact fields."""

from __future__ import annotations

import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License


def normalize_contact_email(value: object) -> str:
    """Return the case-insensitive identity key for a stored email address."""
    if not isinstance(value, str):
        return ""
    return unicodedata.normalize("NFKC", value).strip().casefold()


async def search_contact_references(
    db: AsyncSession,
    search: str,
    *,
    limit: int = 25,
) -> list[dict[str, str]]:
    """Search the shared budget-owner and secondary-contact suggestion set."""
    search_key = normalize_contact_email(search)
    if not search_key:
        return []

    rows = (await db.execute(select(License.budget_owner_email, License.secondary_contacts))).all()
    contacts: dict[str, str] = {}
    for budget_owner_email, secondary_contacts in rows:
        candidates = [budget_owner_email, *(secondary_contacts or [])]
        for candidate in candidates:
            key = normalize_contact_email(candidate)
            if key and search_key in key and key not in contacts:
                contacts[key] = unicodedata.normalize("NFKC", candidate).strip()

    return [{"email": contacts[key]} for key in sorted(contacts)[:limit]]

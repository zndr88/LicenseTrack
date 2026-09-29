import pytest

from app.models.license import License, LicenseMetric, LicenseType
from app.request_context import current_request


async def test_guard_rejects_an_unnumbered_po_inside_a_request(db_session):
    token = current_request.set("POST /api/test")
    try:
        db_session.add(
            License(
                publisher_name="P",
                software_description="S",
                license_type=LicenseType.subscription,
                license_metric=LicenseMetric.per_user,
                currency="EUR",
                po_number="PO-X",
            )
        )
        with pytest.raises(AssertionError, match="no PO line"):
            await db_session.commit()
    finally:
        current_request.reset(token)
        await db_session.rollback()


async def test_guard_allows_a_license_without_a_po_number(db_session):
    token = current_request.set("POST /api/test")
    try:
        db_session.add(
            License(
                publisher_name="P",
                software_description="S",
                license_type=LicenseType.subscription,
                license_metric=LicenseMetric.per_user,
                currency="EUR",
                po_number="",
            )
        )
        await db_session.commit()
    finally:
        current_request.reset(token)

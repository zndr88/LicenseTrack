import pytest

from app.models.license import License, LicenseMetric, LicenseType
from app.request_context import current_request
from app.services.po_line_service import sync_license_line


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


async def test_guard_rejects_a_po_change_that_kept_the_old_line(db_session):
    lic = License(
        publisher_name="P",
        software_description="S",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        po_number="PO-A",
    )
    db_session.add(lic)
    await db_session.flush()
    await sync_license_line(db_session, lic)
    await db_session.commit()

    token = current_request.set("PUT /api/test")
    try:
        lic.po_number = "PO-B"  # the writer forgot sync_license_line
        with pytest.raises(AssertionError, match="another PO"):
            await db_session.commit()
        await db_session.rollback()
        await db_session.refresh(lic)

        lic.po_number = ""
        with pytest.raises(AssertionError, match="still holds"):
            await db_session.commit()
        await db_session.rollback()
        await db_session.refresh(lic)

        lic.po_number = "PO-B"
        await sync_license_line(db_session, lic)
        await db_session.commit()
    finally:
        current_request.reset(token)


def test_only_the_po_line_service_writes_po_lines():
    from pathlib import Path

    from tests.single_owner import find_definitions

    app_root = Path(__file__).resolve().parents[2] / "app"
    assert find_definitions(
        app_root,
        r"PoLineRegister\(|\.po_line(_id)?\s*=[^=]",
        owners={"services/po_line_service.py", "models/po_line.py"},
    ) == []

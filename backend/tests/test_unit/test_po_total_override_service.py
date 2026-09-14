from app.models.license import License, LicenseMetric, LicenseType
from app.services.po_total_override_service import (
    get_po_total_override,
    resolve_reassigned_po_total_override,
)


def _license(**overrides) -> License:
    data = {
        "publisher_name": "Acme",
        "software_description": "Widget",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "po_number": "PO  42",
        "currency": "EUR",
    }
    data.update(overrides)
    return License(**data)


async def test_po_override_lookup_normalizes_repeated_po_whitespace(db_session):
    source = _license(po_total_override="250.00")
    db_session.add(source)
    await db_session.flush()

    override = await get_po_total_override(db_session, "  po       42 ", "eur")

    assert override == "250.00"


async def test_currency_change_clears_standalone_po_override(db_session):
    license_obj = _license(po_total_override="250.00")
    db_session.add(license_obj)
    await db_session.flush()

    override = await resolve_reassigned_po_total_override(
        db_session, license_obj, "PO 42", "USD",
    )

    assert override is None

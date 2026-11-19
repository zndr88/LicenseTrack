import pytest
from sqlalchemy import select

from app.models.document import ProcurementDocument
from app.models.license import License, LicenseMetric, LicenseType
from app.services.procurement_identity import normalize_po_number

SAMPLES = ["PO-1001", "  po   1001 ", "Straße 7", "ΣΊΣΥΦΟΣ", "İstanbul-9", "", "PO\t77 X"]


@pytest.mark.parametrize("raw", SAMPLES)
def test_license_po_key_follows_po_number(raw):
    license_obj = License(po_number=raw)
    assert license_obj.po_key == normalize_po_number(raw)
    license_obj.po_number = "Other 9"
    assert license_obj.po_key == "other 9"


@pytest.mark.parametrize("raw", [*SAMPLES, None])
def test_document_shared_po_key_follows_shared_po_number(raw):
    document = ProcurementDocument(shared_po_number=raw)
    assert document.shared_po_key == (normalize_po_number(raw) if raw is not None else None)


def test_license_without_po_number_has_empty_key():
    assert License().po_key in (None, "")  # column default "" applies at insert


async def test_po_key_is_stored_and_follows_edits(db_session):
    license_obj = License(
        publisher_name="P",
        software_description="S",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity=1,
    )
    db_session.add(license_obj)
    await db_session.commit()
    assert await db_session.scalar(select(License.po_key).where(License.id == license_obj.id)) == ""

    license_obj.po_number = "  PO   Straße 7 "
    await db_session.commit()
    assert await db_session.scalar(select(License.po_key).where(License.id == license_obj.id)) == "po strasse 7"

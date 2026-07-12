from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.contract import Contract, ContractDocument, ContractFolder
from app.models.document import Document, DocumentCategory, ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder
from app.models.settings import GlobalSettings
from app.services.contract_response_service import build_contract_response
from app.services.conversion_response_service import build_conversion_response
from app.services.license_response_service import (
    enrich_license_response,
    get_procurement_documents_by_scope,
)


def _license(**overrides) -> License:
    data = {
        "publisher_name": "Acme",
        "software_description": "Acme Suite",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "1",
        "currency": "EUR",
        "start_date": date(2026, 1, 1),
        "end_date": date(2026, 12, 31),
    }
    data.update(overrides)
    return License(**data)


async def test_enrich_license_response_counts_license_and_procurement_documents(db_session):
    license_obj = _license()
    db_session.add(license_obj)
    await db_session.flush()
    db_session.add(
        Document(
            license_id=license_obj.id,
            filename="documents/invoice.pdf",
            original_filename="invoice.pdf",
            file_size=10,
            mime_type="application/pdf",
            category=DocumentCategory.invoice,
        )
    )
    procurement_doc = ProcurementDocument(
        po_number="PO-1",
        license_id=license_obj.id,
        filename="procurement/quote.pdf",
        original_filename="quote.pdf",
        file_size=20,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.quote,
    )
    db_session.add(procurement_doc)
    await db_session.commit()
    loaded_license = await db_session.scalar(
        select(License)
        .where(License.id == license_obj.id)
        .options(selectinload(License.documents))
    )

    response = enrich_license_response(
        loaded_license,
        mandatory_fields={"invoice": True, "startDate": True},
        procurement_documents=[procurement_doc],
    )

    assert response.id == license_obj.id
    assert response.document_count == 2
    assert response.completeness_pct == 100
    assert response.expiration_status in {"active", "expiring", "expired"}


async def test_get_procurement_documents_by_scope_maps_license_and_pending_order_docs(db_session):
    from app.models.pending_order import PendingOrder
    po1 = PendingOrder(po_number="PO-10")
    po2 = PendingOrder(po_number="PO-20")
    db_session.add_all([po1, po2])
    await db_session.flush()

    first = _license(software_description="First", pending_order_id=po1.id)
    second = _license(software_description="Second", pending_order_id=po2.id)
    db_session.add_all([first, second])
    await db_session.flush()
    first_license_doc = ProcurementDocument(
        po_number="PO-1",
        license_id=first.id,
        filename="procurement/license.pdf",
        original_filename="license.pdf",
        file_size=10,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.purchase_order,
    )
    first_pending_doc = ProcurementDocument(
        po_number="PO-1",
        pending_order_id=po1.id,
        filename="procurement/pending.pdf",
        original_filename="pending.pdf",
        file_size=10,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.invoice,
    )
    second_pending_doc = ProcurementDocument(
        po_number="PO-2",
        pending_order_id=po2.id,
        filename="procurement/second.pdf",
        original_filename="second.pdf",
        file_size=10,
        mime_type="application/pdf",
        category=ProcurementDocumentCategory.invoice,
    )
    db_session.add_all([first_license_doc, first_pending_doc, second_pending_doc])
    await db_session.commit()

    mapped = await get_procurement_documents_by_scope(db_session, [first, second])

    assert {doc.original_filename for doc in mapped[first.id]} == {"license.pdf", "pending.pdf"}
    assert [doc.original_filename for doc in mapped[second.id]] == ["second.pdf"]


async def test_build_conversion_response_marks_new_and_predecessor_licenses(db_session):
    db_session.add(GlobalSettings(id=1, mandatory_fields={"invoice": True}))
    new_license = _license(software_description="New License")
    predecessor = _license(software_description="Old License")
    db_session.add_all([new_license, predecessor])
    await db_session.flush()
    db_session.add(
        Document(
            license_id=new_license.id,
            filename="documents/invoice.pdf",
            original_filename="invoice.pdf",
            file_size=10,
            mime_type="application/pdf",
            category=DocumentCategory.invoice,
        )
    )
    await db_session.commit()

    responses = await build_conversion_response(
        db_session,
        [(new_license.id, "new_purchase")],
        [predecessor.id],
    )

    by_id = {response.id: response for response in responses}
    assert by_id[new_license.id].conversion_type == "new_purchase"
    assert by_id[new_license.id].document_count == 1
    assert by_id[new_license.id].completeness_pct == 100
    assert by_id[predecessor.id].conversion_type == "renewed_predecessor"


async def test_build_conversion_response_includes_pending_order_procurement_documents(db_session):
    db_session.add(GlobalSettings(id=1, mandatory_fields={"invoice": True}))
    order = PendingOrder(po_number="PO-CONVERT")
    db_session.add(order)
    await db_session.flush()
    new_license = _license(software_description="Converted License", pending_order_id=order.id)
    db_session.add(new_license)
    await db_session.flush()
    db_session.add(
        ProcurementDocument(
            po_number=order.po_number,
            pending_order_id=order.id,
            filename="procurement/invoice.pdf",
            original_filename="invoice.pdf",
            file_size=10,
            mime_type="application/pdf",
            category=ProcurementDocumentCategory.invoice,
        )
    )
    await db_session.commit()

    responses = await build_conversion_response(
        db_session,
        [(new_license.id, "new_purchase")],
        [],
    )

    response = responses[0]
    assert response.document_count == 1
    assert response.completeness_pct == 100


async def test_build_contract_response_counts_licenses_documents_and_folder_documents(db_session):
    contract = Contract(contract_number="CTR-1", publisher_name="Acme")
    db_session.add(contract)
    await db_session.flush()
    folder = ContractFolder(contract_id=contract.id, name="Legal")
    db_session.add(folder)
    db_session.add_all(
        [
            License(
                publisher_name="Acme",
                software_description="IT License",
                license_type=LicenseType.subscription,
                license_metric=LicenseMetric.per_user,
                currency="EUR",
                contract_number="ctr-1",
                cost_centre="IT",
            ),
            License(
                publisher_name="Acme",
                software_description="Finance License",
                license_type=LicenseType.subscription,
                license_metric=LicenseMetric.per_user,
                currency="EUR",
                contract_number="CTR-1",
                cost_centre="Finance",
            ),
        ]
    )
    await db_session.flush()
    db_session.add_all(
        [
            ContractDocument(
                contract_id=contract.id,
                folder_id=folder.id,
                filename="contracts/legal.pdf",
                original_filename="legal.pdf",
                file_size=1,
            ),
            ContractDocument(
                contract_id=contract.id,
                folder_id=None,
                filename="contracts/root.pdf",
                original_filename="root.pdf",
                file_size=1,
            ),
        ]
    )
    await db_session.commit()
    loaded_contract = await db_session.scalar(
        select(Contract)
        .where(Contract.id == contract.id)
        .options(selectinload(Contract.folders))
    )

    response = await build_contract_response(loaded_contract, db_session, departments=["IT"])

    assert response.license_count == 1
    assert response.document_count == 2
    assert len(response.folders) == 1
    assert response.folders[0].name == "Legal"
    assert response.folders[0].document_count == 1

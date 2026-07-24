"""Integration coverage for the fixed-scope portfolio reset."""

from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.contract import Contract, ContractDocument
from app.models.custom_fields import CustomFieldDefinition, CustomFieldValue
from app.models.document import (
    Document,
    DocumentCategory,
    ProcurementDocument,
    ProcurementDocumentCategory,
)
from app.models.license import License, LicenseMetric, LicenseType
from app.models.license_ref_seq import LicenseRefSequence
from app.models.pending_order import PendingOrder
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest
from app.models.user import User


async def _count(db_session, model) -> int:
    return int(await db_session.scalar(select(func.count()).select_from(model)) or 0)


async def test_portfolio_reset_deletes_full_history_and_preserves_configuration(
    db_session,
    test_app,
    auth_headers,
    tmp_path,
    monkeypatch,
):
    admin = await db_session.scalar(select(User))
    storage_root = tmp_path / "storage"
    backup_root = tmp_path / "backups"
    managed_file = storage_root / "documents" / "1" / "entitlement.pdf"
    managed_file.parent.mkdir(parents=True)
    managed_file.write_bytes(b"entitlement")

    db_session.add(
        GlobalSettings(
            id=1,
            storage_path=str(storage_root),
            backup_location=str(backup_root),
            manager_email="preserved@example.com",
        )
    )
    custom_field = CustomFieldDefinition(
        name="Environment",
        field_key="environment",
        field_type="text",
    )
    db_session.add(custom_field)
    await db_session.flush()

    contract = Contract(contract_number="C-1", publisher_name="Acme", created_by=admin.id)
    order = PendingOrder(po_number="PO-1", supplier="Acme", created_by=admin.id)
    request = SourcingRequest(supplier="Acme", created_by=admin.id)
    db_session.add_all([contract, order, request])
    await db_session.flush()

    sourcing_item = SourcingItem(
        sourcing_request_id=request.id,
        pending_order_id=order.id,
        publisher_name="Acme",
        software_description="Suite",
        quantity="1",
        currency="EUR",
        created_by=admin.id,
    )
    db_session.add(sourcing_item)
    await db_session.flush()

    license_row = License(
        publisher_name="Acme",
        software_description="Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        license_ref="LT-REF-00042",
        contract_id=contract.id,
        pending_order_id=order.id,
        source_sourcing_item_id=sourcing_item.id,
        created_by=admin.id,
    )
    db_session.add(license_row)
    await db_session.flush()
    sourcing_item.renewal_for_license_id = license_row.id

    db_session.add_all(
        [
            CustomFieldValue(
                license_id=license_row.id,
                custom_field_def_id=custom_field.id,
                value_text="Production",
            ),
            Document(
                license_id=license_row.id,
                filename="documents/1/entitlement.pdf",
                original_filename="entitlement.pdf",
                file_size=11,
                mime_type="application/pdf",
                category=DocumentCategory.entitlement,
                uploaded_by=admin.id,
            ),
            ProcurementDocument(
                po_number=order.po_number,
                pending_order_id=order.id,
                license_id=license_row.id,
                filename="procurement_documents/PO-1/invoice.pdf",
                original_filename="invoice.pdf",
                file_size=7,
                mime_type="application/pdf",
                category=ProcurementDocumentCategory.invoice,
                uploaded_by=admin.id,
            ),
            SourcingQuoteDocument(
                sourcing_request_id=request.id,
                filename="sourcing_requests/1/quote.pdf",
                original_filename="quote.pdf",
                file_size=5,
                mime_type="application/pdf",
                uploaded_by=admin.id,
            ),
            ContractDocument(
                contract_id=contract.id,
                filename="contracts/1/contract.pdf",
                original_filename="contract.pdf",
                file_size=8,
                created_by=admin.id,
            ),
            LicenseRefSequence(id=1, last_value=42),
            AuditLog(actor_email=admin.email, action="license.created"),
        ]
    )
    await db_session.commit()

    archive_path = backup_root / "license_lifecycle_pre_portfolio_reset_test.zip"
    archive_path.parent.mkdir(parents=True)
    archive_path.write_bytes(b"recovery")
    archive_calls = []

    def fake_archive(backup_location, storage_location, counts, document_paths):
        archive_calls.append((backup_location, storage_location, counts, document_paths))
        return archive_path

    monkeypatch.setattr(
        "app.services.portfolio_reset_service.create_portfolio_reset_archive",
        fake_archive,
    )

    response = await test_app.post(
        "/api/operations/portfolio-reset",
        headers=auth_headers,
        json={"confirmation": "RESET PORTFOLIO"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["next_license_ref"] == "LT-REF-00001"
    assert payload["counts"]["licenses"] == 1
    assert payload["counts"]["sourcing_requests"] == 1
    assert payload["counts"]["pending_orders"] == 1
    assert payload["archive_filename"] == archive_path.name
    assert archive_calls[0][0:2] == (str(backup_root), str(storage_root))
    assert "documents/1/entitlement.pdf" in archive_calls[0][3]

    for model in (
        License,
        CustomFieldValue,
        Document,
        ProcurementDocument,
        SourcingQuoteDocument,
        SourcingItem,
        SourcingRequest,
        PendingOrder,
        ContractDocument,
        Contract,
    ):
        assert await _count(db_session, model) == 0

    assert await _count(db_session, User) == 1
    assert await _count(db_session, CustomFieldDefinition) == 1
    settings_row = await db_session.get(GlobalSettings, 1)
    assert settings_row.manager_email == "preserved@example.com"
    sequence = await db_session.get(LicenseRefSequence, 1)
    assert sequence.last_value == 0

    audit_rows = (await db_session.scalars(select(AuditLog))).all()
    assert [row.action for row in audit_rows] == ["system.portfolio_reset"]
    assert not (storage_root / "documents").exists()
    assert archive_path.exists()


async def test_portfolio_reset_requires_exact_confirmation(test_app, auth_headers):
    response = await test_app.post(
        "/api/operations/portfolio-reset",
        headers=auth_headers,
        json={"confirmation": "reset portfolio"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Confirmation phrase does not match."


async def test_portfolio_reset_aborts_without_deleting_when_archive_fails(
    db_session,
    test_app,
    auth_headers,
    monkeypatch,
):
    db_session.add(
        License(
            publisher_name="Acme",
            software_description="Must Survive",
            license_type=LicenseType.subscription,
            license_metric=LicenseMetric.per_user,
            quantity="1",
            license_ref="LT-REF-00001",
        )
    )
    await db_session.commit()

    def fail_archive(*_args):
        raise OSError("backup disk unavailable")

    monkeypatch.setattr(
        "app.services.portfolio_reset_service.create_portfolio_reset_archive",
        fail_archive,
    )

    response = await test_app.post(
        "/api/operations/portfolio-reset",
        headers=auth_headers,
        json={"confirmation": "RESET PORTFOLIO"},
    )

    assert response.status_code == 500
    assert "backup disk unavailable" not in response.text
    assert await _count(db_session, License) == 1


async def test_portfolio_reset_preview_requires_admin_and_reports_counts(
    test_app,
    auth_headers,
):
    response = await test_app.get(
        "/api/operations/portfolio-reset/preview",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["counts"]["licenses"] == 0
    assert response.json()["confirmation"] == "RESET PORTFOLIO"

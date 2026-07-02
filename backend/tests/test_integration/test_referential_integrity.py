"""
Regression tests for SQLite foreign-key enforcement (F2).

Verifies that PRAGMA foreign_keys=ON is active so that FKs declared in
the ORM models are actually enforced at the database level.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.document import Document, DocumentCategory
from app.models.license import License, LicenseMetric, LicenseType


async def test_license_with_nonexistent_contract_id_is_rejected(db_session):
    """Inserting a License with a bogus contract_id must raise IntegrityError."""
    license_obj = License(
        publisher_name="Test",
        software_description="Test Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        contract_id=99999,  # does not exist
    )
    db_session.add(license_obj)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_document_with_nonexistent_license_id_is_rejected(db_session):
    """Inserting a Document with a bogus license_id must raise IntegrityError."""
    doc = Document(
        license_id=99999,  # does not exist
        filename="test.pdf",
        original_filename="test.pdf",
        file_size=100,
        mime_type="application/pdf",
        category=DocumentCategory.other,
        uploaded_by=None,
    )
    db_session.add(doc)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_raw_delete_license_with_documents_raises_integrity_error(db_session):
    """
    Raw SQL DELETE on a license that has child documents must raise IntegrityError.
    The Document FK has no ON DELETE CASCADE, so SQLite enforces RESTRICT.
    This documents that documents must be removed before (or via ORM cascade on)
    the parent license — bypassing the ORM is not safe.
    """
    from sqlalchemy import text

    # Create a license
    lic = License(
        publisher_name="Vendor",
        software_description="Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
    )
    db_session.add(lic)
    await db_session.flush()

    # Attach a document via raw INSERT (bypasses ORM cascade tracking)
    await db_session.execute(
        text(
            "INSERT INTO documents (license_id, filename, original_filename, file_size, mime_type, category)"
            " VALUES (:lid, 'f.pdf', 'f.pdf', 100, 'application/pdf', 'license')"
        ),
        {"lid": lic.id},
    )
    await db_session.flush()

    # Raw delete of the license must be blocked by FK enforcement
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("DELETE FROM licenses WHERE id = :lid"),
            {"lid": lic.id},
        )
        await db_session.flush()

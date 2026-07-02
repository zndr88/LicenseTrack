"""
Unit tests for app.services.audit_service.

log_event tests use the db_session fixture (writes to in-memory SQLite).
diff_fields tests are pure-function, no fixture needed.
"""

from types import SimpleNamespace

from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.user import User, UserRole
from app.services.audit_contracts import format_document_amendment_detail
from app.services.audit_service import (
    diff_fields,
    format_audit_detail,
    log_event,
    set_api_token_audit_context,
)


# ---------------------------------------------------------------------------
# 3a — log_event creates a row
# ---------------------------------------------------------------------------

async def test_log_event_creates_row(db_session):
    await log_event(
        db_session,
        action="test.action",
        target_type="license",
        target_id="1",
        target_label="Test License",
    )
    await db_session.commit()

    rows = (await db_session.execute(select(AuditLog))).scalars().all()

    assert len(rows) == 1
    row = rows[0]
    assert row.action == "test.action"
    assert row.actor_email == "system"
    assert row.target_type == "license"


# ---------------------------------------------------------------------------
# 3b — log_event with actor
# ---------------------------------------------------------------------------

async def test_log_event_with_actor(db_session):
    user = User(
        id=99,
        username="auditactor",
        email="user@test.local",
        hashed_password="x",
        role=UserRole.viewer,
    )
    db_session.add(user)
    await db_session.flush()

    actor = SimpleNamespace(id=99, email="user@test.local")

    await log_event(db_session, action="license.update", actor=actor)
    await db_session.commit()

    row = (await db_session.execute(select(AuditLog))).scalars().first()
    assert row.actor_id == 99
    assert row.actor_email == "user@test.local"


# ---------------------------------------------------------------------------
# 3c — log_event with API token context sets first-class token columns
# ---------------------------------------------------------------------------

async def test_log_event_with_api_token_context(db_session):
    user = User(
        id=1,
        username="apiactor",
        email="admin@test.local",
        hashed_password="x",
        role=UserRole.admin,
    )
    db_session.add(user)
    await db_session.flush()

    set_api_token_audit_context({"id": 7, "name": "ci-pipeline"})
    try:
        actor = SimpleNamespace(id=1, email="admin@test.local")
        await log_event(db_session, action="license.created", actor=actor)
        await db_session.commit()

        row = (await db_session.execute(select(AuditLog))).scalars().first()
        assert row.actor_token_id == 7
        assert row.actor_token_name == "ci-pipeline"
        # token info also embedded in detail for backward-compat search
        assert "ci-pipeline" in (row.detail or "")
    finally:
        set_api_token_audit_context(None)


# ---------------------------------------------------------------------------
# 3d — log_event without token context leaves token columns null
# ---------------------------------------------------------------------------

async def test_log_event_without_token_context_leaves_columns_null(db_session):
    set_api_token_audit_context(None)
    await log_event(db_session, action="license.updated")
    await db_session.commit()

    row = (await db_session.execute(select(AuditLog))).scalars().first()
    assert row.actor_token_id is None
    assert row.actor_token_name is None


# ---------------------------------------------------------------------------
# 3f — diff_fields returns None when nothing changed
# ---------------------------------------------------------------------------

def test_diff_fields_no_change():
    assert diff_fields({"name": "Acme"}, {"name": "Acme"}) is None


# ---------------------------------------------------------------------------
# 3g — diff_fields returns a human-readable change summary
# ---------------------------------------------------------------------------

def test_diff_fields_detects_change():
    result = diff_fields({"name": "Acme", "cost": 100}, {"name": "Acme", "cost": 200})

    assert result is not None
    assert "cost: 100 → 200" in result


# ---------------------------------------------------------------------------
# 3h — diff_fields respects _DEFAULT_EXCLUDE (id is always ignored)
# ---------------------------------------------------------------------------

def test_diff_fields_default_excludes_id():
    # id changed but it's in _DEFAULT_EXCLUDE, so no diff should be reported.
    assert diff_fields({"id": 1, "name": "A"}, {"id": 2, "name": "A"}) is None


# ---------------------------------------------------------------------------
# 3i — diff_fields respects caller-supplied exclude set
# ---------------------------------------------------------------------------

def test_diff_fields_caller_exclude():
    result = diff_fields(
        {"name": "A", "notes": "old"},
        {"name": "A", "notes": "new"},
        exclude={"notes"},
    )
    assert result is None


# ---------------------------------------------------------------------------
# format_audit_detail
# ---------------------------------------------------------------------------


def test_format_audit_detail_puts_mutation_type_first():
    result = format_audit_detail("csv_import", {"insertedCount": "5"})
    lines = result.splitlines()
    assert lines[0] == "mutationType=csv_import"
    assert "insertedCount=5" in result


def test_format_audit_detail_omits_none_values():
    result = format_audit_detail(
        "csv_import",
        {"sourceDocument": None, "insertedCount": "3"},
    )
    assert "sourceDocument" not in result
    assert "insertedCount=3" in result


def test_format_audit_detail_appends_field_diffs():
    result = format_audit_detail(
        "document_processing_acceptance",
        {"resultId": "42"},
        field_diffs=["quantity: 5 → 25"],
    )
    lines = result.splitlines()
    assert lines[0] == "mutationType=document_processing_acceptance"
    assert "resultId=42" in result
    assert lines[-1] == "quantity: 5 → 25"


def test_format_audit_detail_no_context_no_diffs():
    result = format_audit_detail("repair", {})
    assert result == "mutationType=repair"


def test_format_document_amendment_detail_includes_required_context():
    result = format_document_amendment_detail(
        operation="delete",
        post_conversion=True,
        document_category="invoice",
        document_scope="procurement",
        document_id=7,
        filename="invoice.pdf",
        related_license_id=42,
        pending_order_id=9,
        po_number="PO-42",
        actor_email="editor@test.local",
        reason="duplicate invoice",
    )

    assert "mutationType=document_amendment" in result
    assert "operation=delete" in result
    assert "postConversion=true" in result
    assert "documentCategory=invoice" in result
    assert "documentScope=procurement" in result
    assert "documentId=7" in result
    assert "filename=invoice.pdf" in result
    assert "relatedLicenseId=42" in result
    assert "pendingOrderId=9" in result
    assert "poNumber=PO-42" in result
    assert "actorEmail=editor@test.local" in result
    assert "amendmentTimestamp=" in result
    assert "reason=duplicate invoice" in result

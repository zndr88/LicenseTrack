"""Unit tests for budget_owner_email CRLF validation across schemas.

CVE-2026-53533 / GHSA-v3q9-hj7j-63hq: budget_owner_email flows unvalidated
into aiosmtplib.send(recipients=...) via the daily notification job
(app.services.notification_sender). Every schema that accepts this field
from an operator/CSV must reject embedded CR/LF/NUL bytes while still
allowing blank/None "not set" values.
"""

import pytest
from pydantic import ValidationError

from app.models.license import LicenseMetric, LicenseType
from app.schemas.csv_import import CSVImportPreviewRow
from app.schemas.license import LicenseCreate, LicenseUpdate
from app.schemas.pending_order import BatchConvertItem, PendingOrderConvertRequest

_INJECTION_PAYLOAD = "a@b.com\r\nRCPT TO:<evil@x>"


def _license_create_kwargs(**overrides):
    kwargs = dict(
        publisher_name="Acme",
        software_description="Widget",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
    )
    kwargs.update(overrides)
    return kwargs


# ── app.schemas.license.LicenseCreate (LicenseBase) ──────────────────────────

def test_license_create_allows_empty_budget_owner_email():
    m = LicenseCreate(**_license_create_kwargs(budget_owner_email=""))
    assert m.budget_owner_email == ""


def test_license_create_allows_normal_budget_owner_email():
    m = LicenseCreate(**_license_create_kwargs(budget_owner_email="owner@example.com"))
    assert m.budget_owner_email == "owner@example.com"


def test_license_create_rejects_crlf_budget_owner_email():
    with pytest.raises(ValidationError):
        LicenseCreate(**_license_create_kwargs(budget_owner_email=_INJECTION_PAYLOAD))


def test_license_create_normalises_secondary_contacts():
    m = LicenseCreate(
        **_license_create_kwargs(
            secondary_contacts=[
                " secondary@example.com ",
                "",
                None,
                "SECONDARY@example.com",
                "other@example.com",
            ]
        )
    )

    assert m.secondary_contacts == ["secondary@example.com", "other@example.com"]


def test_license_create_rejects_crlf_secondary_contacts():
    with pytest.raises(ValidationError):
        LicenseCreate(**_license_create_kwargs(secondary_contacts=[_INJECTION_PAYLOAD]))


# ── app.schemas.license.LicenseUpdate ─────────────────────────────────────────

def test_license_update_allows_none_budget_owner_email():
    m = LicenseUpdate(budget_owner_email=None)
    assert m.budget_owner_email is None


def test_license_update_allows_normal_budget_owner_email():
    m = LicenseUpdate(budget_owner_email="owner@example.com")
    assert m.budget_owner_email == "owner@example.com"


def test_license_update_rejects_crlf_budget_owner_email():
    with pytest.raises(ValidationError):
        LicenseUpdate(budget_owner_email=_INJECTION_PAYLOAD)


def test_license_update_normalises_secondary_contacts():
    m = LicenseUpdate(
        secondary_contacts=[
            " cc@example.com ",
            "CC@example.com",
            "",
            "legal@example.com",
        ]
    )

    assert m.secondary_contacts == ["cc@example.com", "legal@example.com"]


def test_license_update_rejects_crlf_secondary_contacts():
    with pytest.raises(ValidationError):
        LicenseUpdate(secondary_contacts=[_INJECTION_PAYLOAD])


# ── app.schemas.csv_import.CSVImportPreviewRow ───────────────────────────────

def _preview_row_kwargs(**overrides):
    kwargs = dict(
        row_number=1,
        publisher_name="Acme",
        software_description="Widget",
        import_status="active",
    )
    kwargs.update(overrides)
    return kwargs


def test_csv_preview_row_allows_empty_budget_owner_email():
    row = CSVImportPreviewRow(**_preview_row_kwargs(budget_owner_email=""))
    assert row.budget_owner_email == ""


def test_csv_preview_row_allows_normal_budget_owner_email():
    row = CSVImportPreviewRow(**_preview_row_kwargs(budget_owner_email="owner@example.com"))
    assert row.budget_owner_email == "owner@example.com"


def test_csv_preview_row_rejects_crlf_budget_owner_email():
    with pytest.raises(ValidationError):
        CSVImportPreviewRow(**_preview_row_kwargs(budget_owner_email=_INJECTION_PAYLOAD))


# ── app.schemas.pending_order.PendingOrderConvertRequest ─────────────────────

def _convert_request_kwargs(**overrides):
    kwargs = dict(publisher_name="Acme", software_description="Widget")
    kwargs.update(overrides)
    return kwargs


def test_pending_order_convert_allows_empty_budget_owner_email():
    m = PendingOrderConvertRequest(**_convert_request_kwargs(budget_owner_email=""))
    assert m.budget_owner_email == ""


def test_pending_order_convert_allows_normal_budget_owner_email():
    m = PendingOrderConvertRequest(
        **_convert_request_kwargs(budget_owner_email="owner@example.com")
    )
    assert m.budget_owner_email == "owner@example.com"


def test_pending_order_convert_rejects_crlf_budget_owner_email():
    with pytest.raises(ValidationError):
        PendingOrderConvertRequest(
            **_convert_request_kwargs(budget_owner_email=_INJECTION_PAYLOAD)
        )


# ── app.schemas.pending_order.BatchConvertItem ───────────────────────────────

def _batch_item_kwargs(**overrides):
    kwargs = dict(
        sourcing_item_id=1,
        publisher_name="Acme",
        software_description="Widget",
    )
    kwargs.update(overrides)
    return kwargs


def test_batch_convert_item_allows_empty_budget_owner_email():
    m = BatchConvertItem(**_batch_item_kwargs(budget_owner_email=""))
    assert m.budget_owner_email == ""


def test_batch_convert_item_allows_normal_budget_owner_email():
    m = BatchConvertItem(**_batch_item_kwargs(budget_owner_email="owner@example.com"))
    assert m.budget_owner_email == "owner@example.com"


def test_batch_convert_item_rejects_crlf_budget_owner_email():
    with pytest.raises(ValidationError):
        BatchConvertItem(**_batch_item_kwargs(budget_owner_email=_INJECTION_PAYLOAD))

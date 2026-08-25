"""
Unit tests for the email/notification pipeline.

Covers:
  notification_sender._is_domain_allowed()
  email_templates.budget_owner_alert()
  email_templates.manager_digest()
  notification_sender.run_daily_notifications()  (with send_email mocked)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License, LicenseType, LicenseMetric
from app.models.pending_order import PendingOrder
from app.models.settings import GlobalSettings
from app.services import email_templates
from app.services.notification_sender import _is_domain_allowed, run_daily_notifications


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_license_entry(
    alert_type: str = "expiring",
    days_until_expiry: int = 15,
    po_number: str = "",
    license_type: str = "subscription",
    completeness_pct: int | None = None,
    parent_software_description: str | None = None,
) -> dict:
    return {
        "type": alert_type,
        "license_id": 1,
        "license_type": license_type,
        "software_description": "Acme Suite",
        "publisher_name": "Acme Corp",
        "start_date": "2024-01-01",
        "end_date": "2025-01-01",
        "notice_date": "2024-11-01",
        "days_until_expiry": days_until_expiry,
        "quantity": "10",
        "cost_centre": "IT",
        "contract_number": "CN-001",
        "po_number": po_number,
        "contact_email": "it@example.com",
        "budget_owner_email": "owner@example.com",
        "completeness_pct": completeness_pct,

        "parent_license_id": None,
        "parent_publisher_name": None,
        "parent_software_description": parent_software_description,
    }


# ---------------------------------------------------------------------------
# _is_domain_allowed
# ---------------------------------------------------------------------------

def test_is_domain_allowed_empty_whitelist_permits_any_domain():
    assert _is_domain_allowed("user@anything.com", []) is True


def test_is_domain_allowed_matching_domain_permitted():
    assert _is_domain_allowed("user@example.com", ["example.com"]) is True


def test_is_domain_allowed_non_matching_domain_blocked():
    assert _is_domain_allowed("user@evil.com", ["example.com"]) is False


def test_is_domain_allowed_is_case_insensitive():
    assert _is_domain_allowed("user@EXAMPLE.COM", ["example.com"]) is True


def test_is_domain_allowed_multiple_domains():
    allowed = ["example.com", "corp.org"]
    assert _is_domain_allowed("user@corp.org", allowed) is True
    assert _is_domain_allowed("user@other.net", allowed) is False


# ---------------------------------------------------------------------------
# budget_owner_alert
# ---------------------------------------------------------------------------

def test_budget_owner_alert_returns_html_string():
    html = email_templates.budget_owner_alert([_make_license_entry()])
    assert isinstance(html, str)
    assert "<html" not in html.lower() or "div" in html  # it's an HTML fragment


def test_budget_owner_alert_contains_license_details():
    entry = _make_license_entry(days_until_expiry=20)
    html = email_templates.budget_owner_alert([entry])
    assert "Acme Suite" in html
    assert "Acme Corp" in html


def test_budget_owner_alert_shows_expired_label_for_negative_days():
    entry = _make_license_entry(alert_type="expired", days_until_expiry=-5)
    html = email_templates.budget_owner_alert([entry])
    assert "Expired 5 days ago" in html


def test_budget_owner_alert_uses_custom_intro():
    html = email_templates.budget_owner_alert(
        [_make_license_entry()],
        intro_text="Custom intro text here.",
    )
    assert "Custom intro text here." in html


def test_budget_owner_alert_uses_custom_signoff():
    html = email_templates.budget_owner_alert(
        [_make_license_entry()],
        signoff_text="Cheers,\nThe Team",
    )
    assert "Cheers," in html


def test_budget_owner_alert_uses_default_intro_when_none():
    html = email_templates.budget_owner_alert([_make_license_entry()], intro_text=None)
    assert "about to expire or have already expired" in html


def test_budget_owner_alert_groups_licenses_by_po_number():
    entries = [
        _make_license_entry(po_number="PO-001"),
        _make_license_entry(po_number="PO-002"),
    ]
    html = email_templates.budget_owner_alert(entries)
    assert "PO: PO-001" in html
    assert "PO: PO-002" in html


def test_budget_owner_alert_shows_no_po_label_for_empty_po():
    html = email_templates.budget_owner_alert([_make_license_entry(po_number="")])
    assert "No PO Number" in html


def test_budget_owner_alert_maintenance_shows_parent_context():
    entry = _make_license_entry(
        license_type="maintenance",
        parent_software_description="Enterprise Platform",
    )
    html = email_templates.budget_owner_alert([entry])
    assert "Maintenance" in html
    assert "Enterprise Platform" in html


def test_budget_owner_alert_critical_days_styled_red():
    entry = _make_license_entry(days_until_expiry=10)
    html = email_templates.budget_owner_alert([entry])
    # Days ≤ 30 → red (#ef4444)
    assert "#ef4444" in html


def test_budget_owner_alert_warning_days_styled_amber():
    entry = _make_license_entry(days_until_expiry=45)
    html = email_templates.budget_owner_alert([entry])
    # Days 31–60 → amber (#f59e0b)
    assert "#f59e0b" in html


# ---------------------------------------------------------------------------
# manager_digest
# ---------------------------------------------------------------------------

def test_manager_digest_empty_notifications_shows_all_clear():
    html = email_templates.manager_digest([])
    assert "All Clear" in html


def test_manager_digest_counts_expired_expiring_incomplete():
    notifications = [
        _make_license_entry(alert_type="expired", days_until_expiry=-10),
        _make_license_entry(alert_type="expiring", days_until_expiry=5),
        _make_license_entry(alert_type="notice_due", days_until_expiry=12),
        _make_license_entry(alert_type="incomplete", completeness_pct=50),
    ]
    html = email_templates.manager_digest(notifications)
    assert "Expired Licenses" in html
    assert "Expiring Soon" in html
    assert "Notice Deadlines" in html
    assert "Incomplete Records" in html


def test_manager_digest_replaces_total_placeholder_in_custom_intro():
    notifications = [_make_license_entry(), _make_license_entry()]
    html = email_templates.manager_digest(
        notifications,
        intro_text="There are {total} issues.",
    )
    assert "There are 2 issues." in html


def test_manager_digest_uses_default_intro_when_none():
    notifications = [_make_license_entry()]
    html = email_templates.manager_digest(notifications, intro_text=None)
    assert "require attention" in html


def test_manager_digest_incomplete_shows_completeness_percentage():
    entry = _make_license_entry(alert_type="incomplete", completeness_pct=42)
    html = email_templates.manager_digest([entry])
    assert "42% complete" in html


def test_manager_digest_notice_due_shows_notice_copy():
    entry = _make_license_entry(alert_type="notice_due", days_until_expiry=8)
    html = email_templates.manager_digest([entry])
    assert "Notice deadline in 8 days" in html


def test_manager_digest_maintenance_shows_parent_reference():
    entry = _make_license_entry(
        alert_type="expiring",
        license_type="maintenance",
        parent_software_description="Core Platform",
    )
    html = email_templates.manager_digest([entry])
    assert "Core Platform" in html


# ---------------------------------------------------------------------------
# run_daily_notifications — integration (send_email mocked)
# ---------------------------------------------------------------------------

@pytest.fixture
async def smtp_settings(db_session) -> GlobalSettings:
    """Seed GlobalSettings with SMTP configured and email_enabled."""
    gs = GlobalSettings(
        id=1,
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_sender="noreply@example.com",
        email_enabled=True,
        notification_days=30,
        manager_email="manager@example.com",
    )
    db_session.add(gs)
    await db_session.commit()
    return gs


async def test_run_daily_notifications_skips_when_no_settings(db_session):
    result = await run_daily_notifications(db_session)
    assert result["skipped"] is True
    assert result["reason"] == "smtp_not_configured"


async def test_run_daily_notifications_skips_when_smtp_host_missing(db_session):
    db_session.add(GlobalSettings(id=1, smtp_host="", email_enabled=True))
    await db_session.commit()
    result = await run_daily_notifications(db_session)
    assert result["skipped"] is True
    assert result["reason"] == "smtp_not_configured"


async def test_run_daily_notifications_skips_when_email_disabled(db_session):
    db_session.add(
        GlobalSettings(id=1, smtp_host="smtp.example.com", email_enabled=False)
    )
    await db_session.commit()
    result = await run_daily_notifications(db_session)
    assert result["skipped"] is True
    assert result["reason"] == "email_disabled"


async def test_run_daily_notifications_sends_budget_owner_email_for_expiring_license(
    db_session, smtp_settings
):
    expiring = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=10),
        budget_owner_email="owner@example.com",
        is_retired=False,
    )
    db_session.add(expiring)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 1
    assert mock_send.call_count >= 1
    # First call should be to the budget owner
    first_call_args = mock_send.call_args_list[0]
    assert first_call_args[0][1] == "owner@example.com"


async def test_run_daily_notifications_ccs_secondary_contacts(
    db_session, smtp_settings
):
    expiring = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=10),
        budget_owner_email="owner@example.com",
        secondary_contacts=[
            "secondary@example.com",
            "owner@example.com",
            "legal@example.com",
        ],
        is_retired=False,
    )
    db_session.add(expiring)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 1
    budget_owner_call = mock_send.call_args_list[0]
    assert budget_owner_call[0][1] == "owner@example.com"
    assert budget_owner_call.kwargs["cc"] == [
        "secondary@example.com",
        "legal@example.com",
        "manager@example.com",
    ]


async def test_run_daily_notifications_skips_license_with_renewal_notifications_disabled(
    db_session, smtp_settings
):
    expiring = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=10),
        budget_owner_email="owner@example.com",
        is_retired=False,
        renewal_notifications_enabled=False,
    )
    db_session.add(expiring)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 0
    assert result["digest_sent"] is False
    assert result["total_notifications"] == 0
    mock_send.assert_not_called()


async def test_run_daily_notifications_sends_digest_to_manager(
    db_session, smtp_settings
):
    expiring = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=5),
        is_retired=False,
    )
    db_session.add(expiring)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["digest_sent"] is True
    recipients = [call[0][1] for call in mock_send.call_args_list]
    assert "manager@example.com" in recipients


async def test_run_daily_notifications_sends_notice_deadline_only_to_manager(
    db_session, smtp_settings
):
    smtp_settings.notice_notification_days = 14
    notice = License(
        publisher_name="Vendor",
        software_description="Notice App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        notice_date=date.today() + timedelta(days=10),
        budget_owner_email="owner@example.com",
        is_retired=False,
    )
    db_session.add(notice)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    recipients = [call[0][1] for call in mock_send.call_args_list]
    assert result["budget_owner_emails_sent"] == 0
    assert result["digest_sent"] is True
    assert result["total_notifications"] == 1
    assert recipients == ["manager@example.com"]


async def test_run_daily_notifications_skips_handled_notice_deadline(
    db_session, smtp_settings
):
    smtp_settings.notice_notification_days = 14
    handled = License(
        publisher_name="Vendor",
        software_description="Handled Notice",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        notice_date=date.today() + timedelta(days=10),
        notice_handled_at=datetime.now(timezone.utc),
        is_retired=False,
    )
    db_session.add(handled)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["digest_sent"] is False
    assert result["total_notifications"] == 0
    mock_send.assert_not_called()


async def test_run_daily_notifications_skips_domain_not_in_whitelist(
    db_session, smtp_settings
):
    smtp_settings.allowed_email_domains = "example.com"
    await db_session.commit()

    expiring = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=5),
        budget_owner_email="owner@blocked.org",  # domain not whitelisted
        is_retired=False,
    )
    db_session.add(expiring)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 0
    # Budget owner call should be skipped; mock may still be called for digest
    budget_owner_calls = [
        c for c in mock_send.call_args_list if c[0][1] == "owner@blocked.org"
    ]
    assert len(budget_owner_calls) == 0


async def test_run_daily_notifications_skips_legacy_and_renewed_licenses(
    db_session, smtp_settings
):
    for status in ("legacy", "renewed"):
        lic = License(
            publisher_name="Old Vendor",
            software_description=f"Old App ({status})",
            license_type=LicenseType.subscription,
            license_metric=LicenseMetric.per_user,
            currency="EUR",
            end_date=date.today() - timedelta(days=5),  # expired
            budget_owner_email="owner@example.com",
            is_retired=False,
        )
        # Set lifecycle_status directly via column
        lic.lifecycle_status = status
        db_session.add(lic)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ):
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 0
    assert result["total_notifications"] == 0


async def test_run_daily_notifications_counts_expired_licenses(
    db_session, smtp_settings
):
    expired = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() - timedelta(days=10),
        budget_owner_email="owner@example.com",
        is_retired=False,
    )
    db_session.add(expired)
    await db_session.commit()

    with patch("app.services.notification_sender.send_email", new_callable=AsyncMock):
        result = await run_daily_notifications(db_session)

    assert result["total_notifications"] >= 1
    assert result["budget_owner_emails_sent"] == 1


async def test_run_daily_notifications_no_emails_sent_when_no_expiring(
    db_session, smtp_settings
):
    # A license expiring far in the future — outside notification window
    future = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=180),
        budget_owner_email="owner@example.com",
        is_retired=False,
    )
    db_session.add(future)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 0
    assert result["digest_sent"] is False
    mock_send.assert_not_called()


async def test_run_daily_notifications_does_not_alert_for_upcoming_license(
    db_session,
    smtp_settings,
):
    upcoming = License(
        publisher_name="Vendor",
        software_description="Future App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        start_date=date.today() + timedelta(days=5),
        end_date=date.today() + timedelta(days=10),
        budget_owner_email="owner@example.com",
        is_retired=False,
    )
    db_session.add(upcoming)
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email",
        new_callable=AsyncMock,
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["budget_owner_emails_sent"] == 0
    assert result["digest_sent"] is False
    assert result["total_notifications"] == 0
    mock_send.assert_not_called()


async def test_run_daily_notifications_sends_digest_for_incomplete_only_run(
    db_session, smtp_settings
):
    smtp_settings.mandatory_fields = {"poNumber": True}
    db_session.add(
        License(
            publisher_name="Vendor",
            software_description="Incomplete Only",
            license_type=LicenseType.subscription,
            license_metric=LicenseMetric.per_user,
            currency="EUR",
            end_date=date.today() + timedelta(days=180),
            is_retired=False,
        )
    )
    await db_session.commit()

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result == {
        "budget_owner_emails_sent": 0,
        "digest_sent": True,
        "total_notifications": 1,
        "errors": [],
    }
    mock_send.assert_awaited_once()
    assert mock_send.await_args.args[1] == "manager@example.com"
    assert "1 incomplete" in mock_send.await_args.args[2]


async def test_run_daily_notifications_counts_procurement_documents_for_completeness(
    db_session, smtp_settings, tmp_path
):
    smtp_settings.mandatory_fields = {"invoice": True}
    smtp_settings.storage_path = str(tmp_path)
    invoice_path = tmp_path / "procurement" / "invoice.pdf"
    invoice_path.parent.mkdir(parents=True)
    invoice_path.write_bytes(b"invoice")
    order = PendingOrder(po_number="PO-INVOICE")
    db_session.add(order)
    await db_session.flush()
    license_obj = License(
        publisher_name="Vendor",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        end_date=date.today() + timedelta(days=180),
        pending_order_id=order.id,
        is_retired=False,
    )
    db_session.add(license_obj)
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

    with patch(
        "app.services.notification_sender.send_email", new_callable=AsyncMock
    ) as mock_send:
        result = await run_daily_notifications(db_session)

    assert result["total_notifications"] == 0
    assert result["digest_sent"] is False
    mock_send.assert_not_called()

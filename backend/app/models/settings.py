from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


# ---------------------------------------------------------------------------
# Default JSON blobs - mirrors the prototype's settings shape exactly
# ---------------------------------------------------------------------------

_DEFAULT_VISIBLE_IN_LIST: dict = {
    "select": True,
    "licenseRef": False,
    "externalRef": False,
    "publisher": True,
    "description": True,
    "contractNumber": True,
    "poNumber": True,
    "invoiceNumber": False,
    "dates": True,
    "startDate": True,
    "endDate": True,
    "supplier": True,
    "costCentre": True,
    "contactEmail": False,
    "budgetOwnerEmail": False,
    "licenseType": True,
    "licenseMetric": True,
    "quantity": True,
    "skuCode": False,
    "unitPrice": False,
    "totalPoPrice": True,
    "currency": False,
    "requestDate": False,
    "purchaseDate": False,
    "portalUrl": False,
    "notes": False,
    "docs": True,
    "calcTotal": False,
    "createdBy": False,
    "createdAt": False,
    "updatedAt": False,
    "lifecycleStatus": False,
    "syncStatus": False,
    "lastSyncedAt": False,
    "maintenanceCoverage": False,
    "maintenanceStartDate": False,
    "maintenanceEndDate": False,
    "maintenanceCost": False,
}

_DEFAULT_VISIBLE_IN_DETAIL: dict = {
    "supplier": True,
    "costCentre": True,
    "licenseType": True,
    "licenseMetric": True,
    "quantity": True,
    "skuCode": True,
    "unitPrice": True,
    "totalPoPrice": True,
    "notes": True,
    "licenseRef": True,
}

_DEFAULT_RENEWAL_WORKBENCH_COLUMNS: dict = {
    "dueDate": True,
    "days": True,
    "license": True,
    "licenseRef": True,
    "supplier": True,
    "budgetOwner": True,
    "value": True,
    "status": True,
    "riskFlags": True,
    "actions": True,
}

_DEFAULT_MANDATORY_FIELDS: dict = {
    "invoice": False,
    "eula": False,
    "entitlement": False,
    "purchaseOrder": False,
    "quote": False,
    "startDate": False,
    "endDate": False,
    "contractNumber": False,
    "poNumber": False,
    "invoiceNumber": False,
    "contactEmail": False,
    "costCentre": False,
    "budgetOwnerEmail": False,
}


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)

    # Column visibility - stored as JSON blobs matching prototype camelCase keys
    visible_in_list: Mapped[dict] = mapped_column(JSON, nullable=False, default=_DEFAULT_VISIBLE_IN_LIST)
    visible_in_detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=_DEFAULT_VISIBLE_IN_DETAIL)

    # Notification preferences
    notification_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    manager_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # UI preference
    theme: Mapped[str] = mapped_column(String(20), nullable=False, default="light")

    # Display currency (ISO 4217 code)
    display_currency: Mapped[str] = mapped_column(String(10), nullable=False, default="EUR")

    # Column ordering and saved views
    column_order: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    saved_views: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    renewal_workbench_columns: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=_DEFAULT_RENEWAL_WORKBENCH_COLUMNS,
    )

    # Sidebar state
    sidebar_collapsed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # Number format locale (controls thousands/decimal separator style)
    number_format_locale: Mapped[str] = mapped_column(String(10), nullable=False, default="en-US")

    # UI zoom level
    ui_size: Mapped[str] = mapped_column(String(10), nullable=False, default="normal", server_default="normal")

    # Date / time display preferences
    date_format: Mapped[str] = mapped_column(
        String(20), nullable=False, default="DD/MM/YYYY", server_default="DD/MM/YYYY"
    )
    time_format: Mapped[str] = mapped_column(String(5), nullable=False, default="24h", server_default="24h")
    time_zone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC", server_default="UTC")

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="settings")  # noqa: F821


class GlobalSettings(Base):
    """Singleton row - id is always 1."""

    __tablename__ = "global_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)

    # Which document/field categories are mandatory before a license can be saved
    mandatory_fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=_DEFAULT_MANDATORY_FIELDS)

    # Auth policy
    auth_method: Mapped[str] = mapped_column(String(20), nullable=False, default="mfa")
    session_timeout: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    password_min_length: Mapped[int] = mapped_column(Integer, nullable=False, default=12)

    # Notifications (global)
    notification_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    manager_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # SMTP / email
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    smtp_username: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_sender: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Scheduler
    notification_send_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    # Storage
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    # Email domain whitelist (comma-separated, e.g. "company.com,subsidiary.com")
    allowed_email_domains: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Database backup settings
    backup_location: Mapped[str] = mapped_column(String(500), nullable=False, default=lambda: settings.BACKUP_LOCATION)
    backup_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    backup_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    backup_keep: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    # Renewal workbench
    high_value_threshold: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("50000"), server_default="50000"
    )
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Audit log retention
    audit_log_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90, server_default="90")

    # Email notifications master toggle
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # Integrations
    oidc_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    oidc_discovery_url: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    oidc_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    oidc_client_secret: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)

    # Email template customisation
    email_template_budget_owner_intro: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=(
            "You are receiving this mail because the following software licenses "
            "under your ownership are about to expire or have already expired. "
            "Please verify if the following information is correct for renewal "
            "and let us know with a reply to this e-mail. Thank you."
        ),
    )
    email_template_budget_owner_signoff: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="Kind regards,\nThe License Management Team",
    )
    email_template_manager_intro: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="Your daily license summary \u2014 {total} item(s) require attention.",
    )

    # Scheduled backup status (written by the scheduler after each run)
    last_backup_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    last_backup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    # Notification idempotency.
    #   last_notification_sent_date    -- last calendar date a run completed with NO
    #                                     delivery errors (a "successful" run). The
    #                                     scheduler blocks same-day re-sends on this.
    #   last_notification_attempt_date -- last calendar date a run was attempted,
    #                                     regardless of outcome. Lets the scheduler
    #                                     avoid re-running every loop iteration while
    #                                     still distinguishing "attempted but failed"
    #                                     (attempt == today, sent != today) so the UI
    #                                     can surface it and a manual trigger can retry.
    last_notification_sent_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    last_notification_attempt_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

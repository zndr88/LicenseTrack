from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

import zoneinfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.services.email_validation import reject_email_crlf
from app.services.money import SUPPORTED_NUMBER_FORMAT_LOCALES


# Cache available timezones at module load time to avoid repeated filesystem I/O
_VALID_TIMEZONES: frozenset[str] = frozenset(zoneinfo.available_timezones())


# ---------------------------------------------------------------------------
# User Settings
# ---------------------------------------------------------------------------


class UserSettingsUpdate(BaseModel):
    """Partial update - all fields optional."""

    visible_in_list: Optional[dict] = None
    visible_in_detail: Optional[dict] = None
    notification_days: Optional[int] = Field(default=None, ge=1, le=365)
    manager_email: Optional[str] = Field(default=None, max_length=255)
    theme: Optional[str] = Field(default=None, max_length=20)
    display_currency: Optional[str] = Field(default=None, max_length=10)
    number_format_locale: Optional[str] = Field(default=None, max_length=10)
    column_order: Optional[list] = None
    saved_views: Optional[list] = None
    renewal_workbench_columns: Optional[dict] = None
    sidebar_collapsed: Optional[bool] = None
    ui_size: Optional[Literal["normal", "large", "larger"]] = None
    date_format: Optional[Literal["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]] = None
    time_format: Optional[Literal["12h", "24h"]] = None
    time_zone: Optional[str] = None

    @field_validator("number_format_locale")
    @classmethod
    def _validate_number_format_locale(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_NUMBER_FORMAT_LOCALES:
            raise ValueError(f"Unsupported number_format_locale: {v!r}.")
        return v

    @field_validator("time_zone")
    @classmethod
    def _validate_time_zone(cls, v: str | None) -> str | None:
        # "UTC" is always valid - available_timezones() result is platform-dependent
        # and may omit "UTC" on minimal Docker images without tzdata installed.
        if v is not None and v not in _VALID_TIMEZONES and v != "UTC":
            raise ValueError(f"time_zone {v!r} is not a recognised IANA timezone.")
        return v

    @field_validator("manager_email", mode="before")
    @classmethod
    def _reject_manager_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)


class UserSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    visible_in_list: dict
    visible_in_detail: dict
    notification_days: int
    manager_email: str
    theme: str
    display_currency: str
    number_format_locale: str = "en-US"
    column_order: list
    saved_views: list
    renewal_workbench_columns: dict = Field(default_factory=dict)
    sidebar_collapsed: bool = False
    ui_size: str = "normal"
    date_format: str = "DD/MM/YYYY"
    time_format: str = "24h"
    time_zone: str = "UTC"


# ---------------------------------------------------------------------------
# Global Settings
# ---------------------------------------------------------------------------

_SMTP_PASSWORD_MASK = "••••••••"


class GlobalSettingsUpdate(BaseModel):
    """Partial update - all fields optional."""

    mandatory_fields: Optional[dict] = None
    auth_method: Optional[str] = Field(default=None, max_length=20)
    session_timeout: Optional[int] = Field(default=None, ge=1)
    password_min_length: Optional[int] = Field(default=None, ge=6, le=128)
    storage_path: Optional[str] = Field(default=None, max_length=500)
    notification_days: Optional[int] = Field(default=None, ge=1, le=365)
    notice_notification_days: Optional[int] = Field(default=None, ge=1, le=365)
    manager_email: Optional[str] = Field(default=None, max_length=255)
    smtp_host: Optional[str] = Field(default=None, max_length=255)
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(default=None, max_length=255)
    smtp_password: Optional[str] = Field(default=None, max_length=255)
    smtp_sender: Optional[str] = Field(default=None, max_length=255)
    smtp_use_tls: Optional[bool] = None
    smtp_encryption: Optional[Literal["none", "starttls", "tls"]] = None
    notification_send_hour: Optional[int] = Field(default=None, ge=0, le=23)
    allowed_email_domains: Optional[str] = Field(default=None, max_length=1000)
    backup_location: Optional[str] = Field(default=None, max_length=500)
    backup_enabled: Optional[bool] = None
    backup_hour: Optional[int] = Field(default=None, ge=0, le=23)
    backup_keep: Optional[int] = Field(default=None, ge=1, le=100)
    audit_log_retention_days: Optional[int] = Field(default=None, ge=1)
    high_value_threshold: Optional[Decimal] = Field(default=None, ge=0)
    fiscal_year_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    email_enabled: Optional[bool] = None
    oidc_enabled: Optional[bool] = None
    oidc_discovery_url: Optional[str] = Field(default=None, max_length=2000)
    oidc_client_id: Optional[str] = Field(default=None, max_length=255)
    oidc_client_secret: Optional[str] = Field(default=None, max_length=255)
    email_template_budget_owner_intro: Optional[str] = None
    email_template_budget_owner_signoff: Optional[str] = None
    email_template_manager_intro: Optional[str] = None

    @field_validator("manager_email", mode="before")
    @classmethod
    def _reject_manager_email_crlf(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return reject_email_crlf(v)


class GlobalSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mandatory_fields: dict
    auth_method: str
    session_timeout: int
    password_min_length: int
    storage_path: str
    notification_days: int
    notice_notification_days: int = 30
    manager_email: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_sender: str
    smtp_use_tls: bool
    smtp_encryption: Literal["none", "starttls", "tls"] = "starttls"
    notification_send_hour: int
    allowed_email_domains: str
    backup_location: str = "./backups"
    backup_enabled: bool = False
    backup_hour: int = 2
    backup_keep: int = 10
    audit_log_retention_days: int = 90
    high_value_threshold: Decimal = Decimal("50000")
    fiscal_year_start_month: int = 1
    email_enabled: bool = False
    oidc_enabled: bool = False
    oidc_discovery_url: Optional[str] = None
    oidc_client_id: Optional[str] = None
    oidc_client_secret: Optional[str] = None
    oidc_available: bool = False
    email_template_budget_owner_intro: str = ""
    email_template_budget_owner_signoff: str = ""
    email_template_manager_intro: str = ""
    last_backup_status: Optional[str] = None
    last_backup_at: Optional[datetime] = None
    last_notification_sent_date: Optional[date] = None
    last_notification_attempt_date: Optional[date] = None
    last_notification_status: Optional[str] = None
    last_notification_at: Optional[datetime] = None
    last_notification_summary: Optional[dict] = None

    @model_validator(mode="after")
    def mask_smtp_password(self) -> "GlobalSettingsResponse":
        """Mask secrets so credentials never leave the server."""
        if self.smtp_password:
            self.smtp_password = _SMTP_PASSWORD_MASK
        if self.oidc_client_secret:
            self.oidc_client_secret = _SMTP_PASSWORD_MASK
        return self


class GlobalSettingsPublicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mandatory_fields: dict
    notification_days: int
    notice_notification_days: int = 30
    oidc_enabled: bool = False
    oidc_available: bool = False

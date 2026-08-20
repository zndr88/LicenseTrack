# Import all models here so that SQLAlchemy's mapper registry and Alembic's
# autogenerate can discover every table without needing to import each module
# individually in env.py.

from app.models.audit_log import AuditLog  # noqa: F401
from app.models.api_token import ApiToken  # noqa: F401
from app.models.import_mapping import ImportMapping  # noqa: F401
from app.models.license_ref_seq import LicenseRefSequence  # noqa: F401
from app.models.contract import Contract, ContractDocument, ContractFolder  # noqa: F401
from app.models.custom_fields import CustomFieldDefinition, CustomFieldValue  # noqa: F401
from app.models.document import Document, DocumentCategory, ProcurementDocument, ProcurementDocumentCategory  # noqa: F401
from app.models.document_processing import DocumentProcessingResult  # noqa: F401
from app.models.extension import ExtensionCapability  # noqa: F401
from app.models.license import (  # noqa: F401
    License,
    LicenseCoverageHistory,
    LicenseMaintenanceLink,
    LicenseMetric,
    LicenseType,
    LifecycleStatus,
    MaintenanceCoverage,
)
from app.models.pending_order import PendingOrder, PendingOrderStatus  # noqa: F401
from app.models.plugin import (  # noqa: F401
    Plugin,
    PluginAction,
    PluginPermission,
    PluginRuntimeStatus,
    PluginSettingDefinition,
    PluginSettingValue,
    PluginVersion,
)
from app.models.plugin_suggestion import PluginSuggestion  # noqa: F401
from app.models.settings import GlobalSettings, UserSettings  # noqa: F401
from app.models.sourcing import SourcingItem, SourcingQuoteDocument, SourcingRequest, SourcingStatus  # noqa: F401
from app.models.user import AuthProvider, User, UserRole  # noqa: F401
from app.models.user_department_access import UserDepartmentAccess  # noqa: F401
from app.models.webhook import WebhookDelivery, WebhookEndpoint  # noqa: F401

__all__ = [
    "AuditLog",
    "ApiToken",
    "User",
    "UserRole",
    "AuthProvider",
    "License",
    "LicenseCoverageHistory",
    "LicenseMaintenanceLink",
    "LicenseType",
    "MaintenanceCoverage",
    "LicenseMetric",
    "LifecycleStatus",
    "Document",
    "DocumentCategory",
    "ProcurementDocument",
    "ProcurementDocumentCategory",
    "DocumentProcessingResult",
    "ExtensionCapability",
    "UserSettings",
    "GlobalSettings",
    "PendingOrder",
    "PendingOrderStatus",
    "Plugin",
    "PluginVersion",
    "PluginPermission",
    "PluginSettingDefinition",
    "PluginSettingValue",
    "PluginAction",
    "PluginRuntimeStatus",
    "PluginSuggestion",
    "SourcingItem",
    "SourcingRequest",
    "SourcingQuoteDocument",
    "SourcingStatus",
    "Contract",
    "ContractFolder",
    "ContractDocument",
    "CustomFieldDefinition",
    "CustomFieldValue",
    "UserDepartmentAccess",
    "LicenseRefSequence",
    "ImportMapping",
    "WebhookEndpoint",
    "WebhookDelivery",
]

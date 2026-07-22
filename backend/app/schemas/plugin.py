from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


PluginStatus = Literal[
    "installed",
    "disabled",
    "misconfigured",
    "incompatible",
    "enabled",
    "error",
    "uninstalled",
    "unverified",
]
PluginCompatibilityStatus = Literal["compatible", "incompatible", "unknown"]
PluginTrustStatus = Literal["unverified", "verified", "developer"]
PluginHealthStatus = Literal["unknown", "starting", "healthy", "unhealthy", "stopped", "error"]
PluginSettingType = Literal["text", "secret", "boolean", "number", "select", "url", "textarea"]
PluginRequiredRole = Literal["viewer", "editor", "admin"]
PluginRuntimeType = Literal["managedProcess"]

PLUGIN_PERMISSION_CATALOG: dict[str, dict[str, str]] = {
    "documents:read": {
        "description": "Read documents included in an action context.",
        "risk": "high",
    },
    "documents:write": {
        "description": "Attach or create documents through approved core document APIs.",
        "risk": "high",
    },
    "licenses:read": {
        "description": "Read license fields included in an action context.",
        "risk": "medium",
    },
    "procurement:read": {
        "description": "Read sourcing and pending-order fields included in an action context.",
        "risk": "medium",
    },
    "plugin:settings:read": {
        "description": "Read this plugin's own configured settings.",
        "risk": "medium",
    },
    "plugin:settings:write": {
        "description": "Update this plugin's own settings through approved host APIs.",
        "risk": "high",
    },
    "suggestions:license:write": {
        "description": "Create reviewable suggestions for existing license records.",
        "risk": "medium",
    },
    "suggestions:license_draft:write": {
        "description": "Create reviewable suggestions for a draft license before it is saved.",
        "risk": "medium",
    },
    "suggestions:sourcing_item:write": {
        "description": "Create reviewable suggestions for sourcing items.",
        "risk": "medium",
    },
    "suggestions:sourcing_quote_draft:write": {
        "description": "Create multi-line sourcing items from a parsed quote before saving.",
        "risk": "medium",
    },
    "suggestions:pending_order_draft:write": {
        "description": "Create multi-line pending-order item suggestions from a parsed PO before saving.",
        "risk": "medium",
    },
    "suggestions:pending_order_item:write": {
        "description": "Create reviewable suggestions for pending-order line items.",
        "risk": "medium",
    },
    "suggestions:pending_order_conversion:write": {
        "description": "Create reviewable suggestions for pending-order conversion forms.",
        "risk": "medium",
    },
    "actions:invoke": {
        "description": "Receive action invocation requests from LicenseTrack.",
        "risk": "low",
    },
}

PLUGIN_SLOT_CATALOG: dict[str, dict[str, str | bool]] = {
    "settings.plugins.panel": {
        "target_type": "plugin",
        "description": "Host-rendered plugin settings and diagnostics.",
        "action_declarations_allowed": False,
    },
    "document.row.actions": {
        "target_type": "license_document",
        "description": "Actions on an existing document row.",
        "action_declarations_allowed": True,
    },
    "license.detail.actions": {
        "target_type": "license",
        "description": "Actions on an existing license record.",
        "action_declarations_allowed": True,
    },
    "license.add.review.actions": {
        "target_type": "license_draft",
        "description": "Actions during add-license review before save.",
        "action_declarations_allowed": True,
    },
    "sourcing.quote.add.actions": {
        "target_type": "sourcing_quote_draft",
        "description": "Actions during add-sourcing-request to parse an uploaded quote into multiple items.",
        "action_declarations_allowed": True,
    },
    "sourcing.item.edit.actions": {
        "target_type": "sourcing_item",
        "description": "Actions inside a sourcing item edit workflow.",
        "action_declarations_allowed": True,
    },
    "pendingOrder.add.actions": {
        "target_type": "pending_order_draft",
        "description": "Actions during add-pending-order to parse an uploaded PO into multiple items.",
        "action_declarations_allowed": True,
    },
    "pendingOrder.line.edit.actions": {
        "target_type": "pending_order_item",
        "description": "Actions inside a pending-order line edit workflow.",
        "action_declarations_allowed": True,
    },
    "pendingOrder.convert.actions": {
        "target_type": "pending_order_conversion",
        "description": "Actions during pending-order-to-license conversion.",
        "action_declarations_allowed": True,
    },
}


class PluginPublisherManifest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str | None = Field(default=None, max_length=500)


class PluginCompatibilityManifest(BaseModel):
    minVersion: str = Field(min_length=1, max_length=40)
    maxVersionExclusive: str | None = Field(default=None, max_length=40)


class PluginRuntimeManifest(BaseModel):
    type: PluginRuntimeType
    entrypoint: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=20)
    healthPath: str = Field(min_length=1, max_length=200)
    actionsBasePath: str = Field(default="/actions", min_length=1, max_length=200)
    timeoutSeconds: int = Field(default=30, ge=1, le=120)
    startupTimeoutSeconds: int = Field(default=15, ge=1, le=120)

    @field_validator("healthPath", "actionsBasePath")
    @classmethod
    def require_absolute_http_path(cls, value: str) -> str:
        if not value.startswith("/") or "?" in value or "#" in value:
            raise ValueError("Runtime paths must start with '/' and cannot include query strings or fragments")
        return value


class PluginCapabilityManifest(BaseModel):
    key: str = Field(min_length=3, max_length=120)
    type: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)


class PluginSettingManifest(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    type: PluginSettingType
    required: bool = False
    default: str | bool | int | float | None = None
    options: list[str] | None = Field(default=None, max_length=100)
    helpText: str | None = Field(default=None, max_length=500)
    order: int = Field(default=1000, ge=0, le=100000)

    @field_validator("key")
    @classmethod
    def validate_setting_key(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z][A-Za-z0-9]{0,79}", value):
            raise ValueError("Setting key must be a camel-case identifier")
        return value

    @model_validator(mode="after")
    def validate_type_specific_fields(self) -> "PluginSettingManifest":
        if self.type == "secret" and self.default is not None:
            raise ValueError("Secret settings cannot declare defaults")
        if self.type == "select" and not self.options:
            raise ValueError("Select settings require options")
        if self.type != "select" and self.options:
            raise ValueError("Only select settings can declare options")
        return self


class PluginActionManifest(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    slot: str = Field(min_length=1, max_length=120)
    handler: str = Field(min_length=1, max_length=120)
    requiredRole: PluginRequiredRole
    icon: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    timeoutSeconds: int | None = Field(default=None, ge=1, le=120)

    @field_validator("key")
    @classmethod
    def validate_action_key(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z][A-Za-z0-9]{0,79}", value):
            raise ValueError("Action key must be a camel-case identifier")
        return value

    @field_validator("slot")
    @classmethod
    def validate_action_slot(cls, value: str) -> str:
        slot = PLUGIN_SLOT_CATALOG.get(value)
        if not slot or not slot["action_declarations_allowed"]:
            raise ValueError("Unknown or unsupported plugin action slot")
        return value

    @field_validator("handler")
    @classmethod
    def validate_handler(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", value):
            raise ValueError("Handler contains unsupported characters")
        return value


class PluginManifest(BaseModel):
    manifestVersion: Literal[1]
    key: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=80)
    publisher: PluginPublisherManifest
    licenseTrack: PluginCompatibilityManifest
    description: str | None = Field(default=None, max_length=1000)
    runtime: PluginRuntimeManifest
    permissions: list[str] = Field(max_length=100)
    permissionRationale: dict[str, str] = Field(default_factory=dict)
    capabilities: list[PluginCapabilityManifest] = Field(default_factory=list, max_length=50)
    settings: list[PluginSettingManifest] = Field(default_factory=list, max_length=100)
    actions: list[PluginActionManifest] = Field(default_factory=list, max_length=100)

    @field_validator("key")
    @classmethod
    def validate_plugin_key(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])", value) or "--" in value:
            raise ValueError("Plugin key must be a lowercase slug")
        return value

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, value: list[str]) -> list[str]:
        unknown = sorted(set(value) - set(PLUGIN_PERMISSION_CATALOG))
        if unknown:
            raise ValueError(f"Unknown plugin permission: {', '.join(unknown)}")
        if len(value) != len(set(value)):
            raise ValueError("Plugin permissions must be unique")
        return value

    @model_validator(mode="after")
    def validate_unique_declarations(self) -> "PluginManifest":
        _require_unique([capability.key for capability in self.capabilities], "capability")
        _require_unique([setting.key for setting in self.settings], "setting")
        _require_unique([action.key for action in self.actions], "action")
        unknown_rationales = sorted(set(self.permissionRationale) - set(self.permissions))
        if unknown_rationales:
            raise ValueError(
                f"Permission rationale provided for unrequested permission: {', '.join(unknown_rationales)}"
            )
        for rationale in self.permissionRationale.values():
            if len(rationale) > 500:
                raise ValueError("Permission rationale must be 500 characters or fewer")
        return self


def _require_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"Plugin {label} declarations must be unique")


class PluginPackageIssue(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    code: str
    message: str
    severity: Literal["info", "warning", "error"]
    path: str | None = None


class PluginPermissionPreview(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    permission: str
    description: str
    risk: Literal["low", "medium", "high"]
    rationale: str | None = None


class PluginInstallPreview(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    manifest: PluginManifest | None = None
    checksum_sha256: str
    signed_content_sha256: str
    package_size_bytes: int
    compatibility_status: PluginCompatibilityStatus
    trust_status: PluginTrustStatus
    signer_key_id: str | None = None
    signer_identity: str | None = None
    verified_at: datetime | None = None
    developer_mode: bool = False
    permissions: list[PluginPermissionPreview] = Field(default_factory=list)
    issues: list[PluginPackageIssue] = Field(default_factory=list)
    installable: bool


class PluginPermissionCreate(BaseModel):
    permission: str = Field(min_length=1, max_length=120)
    granted: bool = False

    @field_validator("permission")
    @classmethod
    def validate_known_permission(cls, value: str) -> str:
        if value not in PLUGIN_PERMISSION_CATALOG:
            raise ValueError("Unknown plugin permission")
        return value


class PluginSettingDefinitionCreate(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    type: PluginSettingType
    label: str = Field(min_length=1, max_length=120)
    required: bool = False
    default: str | bool | int | float | None = None
    options: list[str] | None = Field(default=None, max_length=100)
    help_text: str | None = Field(default=None, max_length=500)
    order: int = Field(default=1000, ge=0, le=100000)


class PluginActionCreate(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    slot: str = Field(min_length=1, max_length=120)
    handler: str = Field(min_length=1, max_length=120)
    required_role: PluginRequiredRole
    enabled: bool = False
    icon: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    timeout_seconds: int | None = Field(default=None, ge=1, le=120)

    @field_validator("slot")
    @classmethod
    def validate_known_action_slot(cls, value: str) -> str:
        slot = PLUGIN_SLOT_CATALOG.get(value)
        if not slot or not slot["action_declarations_allowed"]:
            raise ValueError("Unknown or unsupported plugin action slot")
        return value


class PluginRegistryCreate(BaseModel):
    key: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    publisher_name: str = Field(min_length=1, max_length=120)
    publisher_url: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    installed_version: str = Field(min_length=1, max_length=80)
    compatibility_status: PluginCompatibilityStatus = "unknown"
    install_path: str = Field(min_length=1)
    package_path: str = Field(min_length=1)
    checksum_sha256: str = Field(min_length=64, max_length=64)
    signed_content_sha256: str | None = Field(default=None, min_length=64, max_length=64)
    trust_status: PluginTrustStatus = "developer"
    signer_key_id: str | None = Field(default=None, max_length=120)
    signer_identity: str | None = Field(default=None, max_length=200)
    verified_at: datetime | None = None
    manifest: dict
    permissions: list[PluginPermissionCreate] = Field(default_factory=list)
    settings: list[PluginSettingDefinitionCreate] = Field(default_factory=list)
    actions: list[PluginActionCreate] = Field(default_factory=list)


class PluginRegistryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    publisher_name: str | None = Field(default=None, min_length=1, max_length=120)
    publisher_url: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    status: PluginStatus | None = None
    enabled: bool | None = None
    compatibility_status: PluginCompatibilityStatus | None = None
    last_error: str | None = Field(default=None, max_length=2000)


class PluginVersionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    version: str
    package_path: str
    checksum_sha256: str
    signed_content_sha256: str | None
    trust_status: str
    signer_key_id: str | None
    signer_identity: str | None
    verified_at: datetime | None
    manifest: dict
    installed_at: datetime
    activated_at: datetime | None


class PluginPermissionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    permission: str
    granted: bool
    granted_by: int | None
    granted_at: datetime | None


class PluginSettingDefinitionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    setting_key: str
    setting_type: str
    label: str
    required: bool
    default_value: str | bool | int | float | dict | list | None
    options: list | None
    help_text: str | None
    display_order: int


class PluginActionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    action_key: str
    label: str
    slot: str
    handler: str
    required_role: str
    enabled: bool
    icon: str | None
    description: str | None
    timeout_seconds: int | None


class PluginRuntimeStatusResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    pid: int | None
    port: int | None
    process_metadata: dict | None
    health: str
    last_heartbeat_at: datetime | None
    last_error: str | None
    log_path: str | None
    updated_at: datetime


class PluginRuntimeLogsResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    plugin_key: str
    log: str
    truncated: bool = False
    max_bytes: int


class PluginRuntimeHealthResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    status: Literal["ok", "error"]
    version: str | None = None
    details: dict = Field(default_factory=dict)


class PluginRuntimeSettingValue(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    key: str
    value: str | bool | int | float | None
    required: bool = False
    configured: bool = False


class PluginRuntimeSettingsResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    plugin_key: str
    values: list[PluginRuntimeSettingValue]
    missing_required: list[str] = Field(default_factory=list)


class PluginRuntimeDocumentContentResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    document_type: str
    document_id: int
    file_name: str
    content_type: str
    size_bytes: int
    content_base64: str
    text: str | None = None


class PluginActionActor(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: int
    role: PluginRequiredRole


class PluginActionInvokeRuntimeRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    action_key: str
    handler: str
    plugin_key: str
    request_id: UUID
    actor: PluginActionActor
    context: dict


class PluginActionListItem(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    plugin_key: str
    plugin_name: str
    action_key: str
    key: str
    label: str
    slot: str
    required_role: PluginRequiredRole
    icon: str | None = None
    description: str | None = None


class PluginActionsListResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    slot: str
    target_type: str
    target_id: str
    actions: list[PluginActionListItem]


class PluginActionInvokeRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    target_type: str
    target_id: str
    context: dict = Field(default_factory=dict)


class PluginActionInvokeResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    plugin_key: str
    action_key: str
    request_id: UUID
    status: str
    summary: str | None = None
    suggestions_created: int = 0
    raw_output: dict = Field(default_factory=dict)
    draft_suggestions: list[dict] | None = None
    multi_items: list[dict] | None = None


PLUGIN_SECRET_MASK = "••••••••"


class PluginSettingValueRead(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    key: str
    value: str | bool | int | float | None
    masked: bool = False
    required: bool = False
    configured: bool = False


class PluginSettingsReadResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    plugin_key: str
    definitions: list[PluginSettingDefinitionResponse]
    values: list[PluginSettingValueRead]
    missing_required: list[str]


class PluginSettingValueUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    key: str = Field(min_length=1, max_length=80)
    value: str | bool | int | float | None = None
    masked: bool = False


class PluginSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    values: list[PluginSettingValueUpdate]

    @field_validator("values")
    @classmethod
    def require_unique_keys(cls, value: list[PluginSettingValueUpdate]) -> list[PluginSettingValueUpdate]:
        keys = [item.key for item in value]
        if len(keys) != len(set(keys)):
            raise ValueError("Plugin setting keys must be unique")
        return value


class PluginDetailResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    key: str
    name: str
    publisher_name: str
    publisher_url: str | None
    description: str | None
    installed_version: str
    status: str
    enabled: bool
    compatibility_status: str
    trust_status: str
    signer_key_id: str | None
    signer_identity: str | None
    verified_at: datetime | None
    install_path: str
    manifest: dict
    last_error: str | None
    created_at: datetime
    updated_at: datetime
    versions: list[PluginVersionResponse]
    permissions: list[PluginPermissionResponse]
    setting_definitions: list[PluginSettingDefinitionResponse]
    actions: list[PluginActionResponse]
    runtime_status: PluginRuntimeStatusResponse | None


class PluginHostStatusResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    enabled: bool
    developer_mode: bool
    trusted_key_count: int

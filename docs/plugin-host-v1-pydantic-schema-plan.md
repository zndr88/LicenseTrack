# Plugin Host V1 Pydantic Schema Plan

This document is the Phase 0 backend schema plan for Plugin Host v1. It is intentionally JSON-schema-like, but named as Pydantic implementation targets so backend phases can add or extend `backend/app/schemas/plugin.py` without reworking the public contract.

Phase 1 status: complete. The initial registry schemas, catalog constants, ORM models, Alembic migration, and service tests are implemented. Later phases should extend this file's remaining package, runtime, action, and suggestion schema targets as they are built.

Phase 2 status: complete. Manifest, package preview, permission preview, and install response schemas are implemented for backend package intake.

Phase 4 status: complete. Settings read/update schemas and secret masking behavior are implemented for plugin-owned settings.

Phase 5 status: complete. Lifecycle endpoints reuse `PluginDetailResponse` for enable/disable results and `204 No Content` for uninstall; no additional Pydantic request models were required.

Phase 6 status: complete. Runtime status/log response schemas, managed-runtime health contract support, runtime-token settings access, and scoped runtime document content response schemas are implemented; action discovery/invocation schemas remain future work.

Phase 7 status: complete for first-slot action discovery and invocation schemas. `PluginActionListItem`, `PluginActionsListResponse`, and `PluginActionInvokeResponse` support `document.row.actions` with `license_document` context.

Phase 10 status: complete without additional schema classes. The `licensetrack-ai` package validates against the existing manifest models and the host fixture exercises the existing settings, runtime, action invocation, and generic suggestion schemas end to end.

See `docs/plugin-host-v1-roadmap.md` for the frozen product contract and `docs/plugin-author-guide.md` for author-facing examples.

## Module Target

Create:

```text
backend/app/schemas/plugin.py
```

Use the existing backend schema style:

- Pydantic v2 models.
- `ConfigDict(alias_generator=to_camel, populate_by_name=True)` for API response/request models.
- Manifest models should preserve the manifest's camelCase JSON names with explicit fields.
- Validators should normalize path and slug-like fields before service-level validation.

## Shared Enums And Literals

```python
ManifestVersion = Literal[1]
PluginRuntimeType = Literal["managedProcess"]
PluginStatus = Literal[
    "installed",
    "disabled",
    "misconfigured",
    "incompatible",
    "enabled",
    "error",
    "uninstalled",
]
PluginCompatibilityStatus = Literal["compatible", "incompatible", "unknown"]
PluginHealthStatus = Literal["unknown", "starting", "healthy", "unhealthy", "stopped", "error"]
PluginSettingType = Literal["text", "secret", "boolean", "number", "select", "url", "textarea"]
PluginRequiredRole = Literal["viewer", "editor", "admin"]
PluginActionStatus = Literal["ok", "error"]
SuggestionTargetType = Literal[
    "license",
    "license_draft",
    "sourcing_item",
    "pending_order_item",
    "pending_order_conversion",
]
SuggestionStatus = Literal["pending", "accepted", "rejected", "superseded"]
```

## Catalog Constants

```python
PLUGIN_MANIFEST_FILENAME = "plugin.ltplugin"
DEFAULT_MAX_PLUGIN_PACKAGE_BYTES = 50 * 1024 * 1024

PLUGIN_PERMISSION_CATALOG = {
    "documents:read": {...},
    "documents:write": {...},
    "licenses:read": {...},
    "procurement:read": {...},
    "plugin:settings:read": {...},
    "plugin:settings:write": {...},
    "suggestions:license:write": {...},
    "suggestions:license_draft:write": {...},
    "suggestions:sourcing_item:write": {...},
    "suggestions:pending_order_item:write": {...},
    "suggestions:pending_order_conversion:write": {...},
    "actions:invoke": {...},
}

PLUGIN_SLOT_CATALOG = {
    "settings.plugins.panel": {...},
    "document.row.actions": {...},
    "license.detail.actions": {...},
    "license.add.review.actions": {...},
    "sourcing.item.edit.actions": {...},
    "pendingOrder.line.edit.actions": {...},
    "pendingOrder.convert.actions": {...},
}
```

Each permission catalog entry should include:

```python
{
    "description": str,
    "risk": Literal["low", "medium", "high"],
}
```

Each slot catalog entry should include:

```python
{
    "target_type": str,
    "description": str,
    "action_declarations_allowed": bool,
}
```

`settings.plugins.panel` exists in the catalog but has `action_declarations_allowed=False`.

## Manifest Models

```python
class PluginPublisherManifest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: AnyUrl | None = None


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


class PluginActionManifest(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    slot: str = Field(min_length=1, max_length=120)
    handler: str = Field(min_length=1, max_length=120)
    requiredRole: PluginRequiredRole
    icon: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    timeoutSeconds: int | None = Field(default=None, ge=1, le=120)


class PluginManifest(BaseModel):
    manifestVersion: ManifestVersion
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
```

Manifest validators:

- `key`: lowercase slug regex `^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$`, no consecutive hyphens.
- `version`, `licenseTrack.minVersion`, and `licenseTrack.maxVersionExclusive`: semantic version compatible with Python `packaging.version.Version`.
- `runtime.entrypoint`: relative path, starts with `runtime/`, no absolute paths, no `.` or `..` segments, no backslashes, no drive letters.
- `runtime.healthPath` and `runtime.actionsBasePath`: start with `/`, no query string or fragment.
- `permissions`: unique and present in `PLUGIN_PERMISSION_CATALOG`.
- `permissionRationale`: keys must be requested permissions, values max 500 chars.
- `capabilities.key`: unique per plugin.
- `settings.key`: camel-case identifier regex `^[a-z][A-Za-z0-9]{0,79}$`, unique per plugin.
- `settings`: `secret` cannot have `default`; `select` must have non-empty `options`; non-`select` should not have `options`.
- `actions.key`: camel-case identifier regex `^[a-z][A-Za-z0-9]{0,79}$`, unique per plugin.
- `actions.slot`: present in `PLUGIN_SLOT_CATALOG` and `action_declarations_allowed=True`.
- `actions.handler`: regex `^[A-Za-z0-9_.:-]{1,120}$`.

Service-level validators should also check current LicenseTrack version compatibility and package entry existence.

## Package Preview Schemas

```python
class PluginPackageIssue(BaseModel):
    code: str
    message: str
    severity: Literal["info", "warning", "error"]
    path: str | None = None


class PluginPermissionPreview(BaseModel):
    permission: str
    description: str
    risk: Literal["low", "medium", "high"]
    rationale: str | None = None


class PluginInstallPreview(BaseModel):
    manifest: PluginManifest
    checksumSha256: str
    packageSizeBytes: int
    compatibilityStatus: PluginCompatibilityStatus
    permissions: list[PluginPermissionPreview]
    issues: list[PluginPackageIssue]
    installable: bool
```

Preview service checks:

- Package size <= configured maximum.
- Exactly one root `plugin.ltplugin`.
- Required root entries exist.
- No symlinks.
- No absolute paths.
- No path traversal.
- No backslash or drive-letter paths.
- No duplicate normalized paths.
- Manifest parses and validates.
- Runtime entrypoint exists.
- Requested permissions and slots are known.
- Compatibility range includes current LicenseTrack version.

## Registry API Schemas

```python
class PluginSummary(BaseModel):
    key: str
    name: str
    publisherName: str
    installedVersion: str
    status: PluginStatus
    enabled: bool
    compatibilityStatus: PluginCompatibilityStatus
    health: PluginHealthStatus
    lastError: str | None
    updatedAt: datetime


class PluginDetail(PluginSummary):
    description: str | None
    publisherUrl: str | None
    installPath: str
    checksumSha256: str
    manifest: PluginManifest
    permissions: list[PluginPermissionPreview]
    settings: list[PluginSettingManifest]
    actions: list[PluginActionManifest]
    createdAt: datetime
```

Phase 1 implemented the initial registry persistence and service tests before package upload routes exist.

## Settings API Schemas

```python
class PluginSettingValueRead(BaseModel):
    key: str
    value: str | bool | int | float | None
    masked: bool = False
    required: bool = False
    configured: bool = False


class PluginSettingValueUpdate(BaseModel):
    key: str
    value: str | bool | int | float | None
    masked: bool = False


class PluginSettingsReadResponse(BaseModel):
    pluginKey: str
    definitions: list[PluginSettingManifest]
    values: list[PluginSettingValueRead]
    missingRequired: list[str]


class PluginSettingsUpdateRequest(BaseModel):
    values: list[PluginSettingValueUpdate]
```

Validation rules:

- Values must match declared setting type.
- Secret values are encrypted by the service, not the schema.
- Masked secret placeholders preserve existing stored secret values.
- Unknown setting keys are rejected.
- Required settings are considered missing when empty, null, or only whitespace for string-like values.

## Runtime Protocol Schemas

```python
class PluginRuntimeHealthResponse(BaseModel):
    status: Literal["ok", "error"]
    version: str | None = None
    details: dict = Field(default_factory=dict)


class PluginActionActor(BaseModel):
    id: int
    role: PluginRequiredRole


class PluginActionInvokeRequest(BaseModel):
    actionKey: str
    handler: str
    pluginKey: str
    requestId: UUID
    actor: PluginActionActor
    context: dict


class PluginActionError(BaseModel):
    code: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=1000)
    retryable: bool = False
    details: dict = Field(default_factory=dict)


class PluginSuggestedField(BaseModel):
    field: str = Field(min_length=1, max_length=120)
    value: Any
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class PluginSuggestionLineItem(BaseModel):
    fields: list[PluginSuggestedField] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class PluginSuggestion(BaseModel):
    targetType: SuggestionTargetType
    targetId: int | str | None = None
    summary: str | None = Field(default=None, max_length=1000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    fields: list[PluginSuggestedField] = Field(default_factory=list)
    lineItems: list[PluginSuggestionLineItem] = Field(default_factory=list)
    rawOutput: dict = Field(default_factory=dict)


class PluginActionSuccessResponse(BaseModel):
    status: Literal["ok"]
    summary: str | None = Field(default=None, max_length=1000)
    suggestions: list[PluginSuggestion] = Field(default_factory=list, max_length=100)
    rawOutput: dict = Field(default_factory=dict)


class PluginActionErrorResponse(BaseModel):
    status: Literal["error"]
    error: PluginActionError


PluginActionResponse = Annotated[
    PluginActionSuccessResponse | PluginActionErrorResponse,
    Field(discriminator="status"),
]
```

Runtime manager responsibilities outside Pydantic:

- Allocate a loopback port.
- Generate per-plugin runtime token.
- Inject runtime environment variables.
- Check startup health within `startupTimeoutSeconds`.
- Apply action timeout.
- Redact settings in captured logs.
- Record bounded log tails and health status.

## Action Discovery Schemas

```python
class PluginActionListItem(BaseModel):
    pluginKey: str
    pluginName: str
    actionKey: str
    label: str
    slot: str
    requiredRole: PluginRequiredRole
    icon: str | None = None
    description: str | None = None


class PluginActionsListResponse(BaseModel):
    slot: str
    targetType: str
    actions: list[PluginActionListItem]
```

Discovery service filters:

- Plugin is enabled.
- Plugin runtime is healthy when runtime is required.
- Action slot matches.
- Actor has `requiredRole`.
- Plugin has required permissions for the action's target.
- Context builder can produce a scoped payload for the target.

## Generic Suggestion Persistence Schemas

Status: implemented for Phase 8 license-target review.

These schemas are for API contracts around stored suggestions, separate from runtime responses.

```python
class PluginSuggestionRecord(BaseModel):
    id: int
    pluginKey: str
    actionKey: str
    targetType: SuggestionTargetType
    targetId: str
    status: SuggestionStatus
    summary: str | None
    confidence: float | None
    fields: list[PluginSuggestedField]
    lineItems: list[PluginSuggestionLineItem]
    createdAt: datetime
    reviewedAt: datetime | None
    reviewedBy: int | None


class PluginSuggestionDecisionRequest(BaseModel):
    selectedFields: list[str] = Field(default_factory=list)
    selectedLineItems: list[int] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=1000)
```

Implemented schema classes:

- `PluginSuggestedField`
- `PluginSuggestionLineItem`
- `PluginSuggestionResponse`
- `PluginSuggestionAcceptRequest`
- `PluginSuggestionReviewResponse`

Implemented response fields use camelCase aliases and include `pluginId`, `pluginKey`, `actionKey`, `targetType`, `targetId`, `licenseId`, `status`, `suggestedFields`, `lineItems`, `summary`, `confidence`, `rawOutput`, `createdBy`, `createdAt`, `reviewedBy`, and `reviewedAt`.

`PluginActionInvokeResponse` now includes `suggestionsCreated` so slot UI can refresh the suggestion queue after an action returns reviewable output.

Phase 9 extends `PluginActionInvokeRequest` with optional `context` for form-scoped draft payloads. Core still validates database-owned target scope before invoking the runtime.

Implemented Phase 9 action context targets:

- `license_document` for `document.row.actions`.
- `sourcing_item` for `sourcing.item.edit.actions`.
- `pending_order_item` for `pendingOrder.line.edit.actions`.
- `pending_order_conversion` for `pendingOrder.convert.actions`.
- `license_draft` for `license.add.review.actions`.

Suggestion service rules:

- Unknown targets are rejected.
- Target-specific suggestion permissions are required before records are created.
- Unknown fields are rejected against target-specific allowlists.
- Lifecycle, procurement conversion state, and internal identity fields are rejected.
- Accepting selected fields uses existing write services.
- Rejection does not mutate business data.
- New pending suggestions can supersede older pending suggestions for the same plugin, action, target type, and target id.
- Audit events include plugin, action, target, reviewer, decision, and applied fields.

## Phase Mapping

Phase 1 is complete: registry persistence schemas and service-level tests are in place.

Phase 2 is complete: manifest and package preview schemas, plus package inspection validation, are in place.

Phase 4 is complete: settings read/update schemas and secret masking behavior are implemented.

Phase 5 is complete: lifecycle enable/disable/uninstall routes use existing plugin detail response schemas and service-level validation.

Phase 6 is complete: runtime health/log schemas and managed-runtime service support are implemented.

Runtime access schemas added after Phase 10:

- `PluginRuntimeSettingValue`
- `PluginRuntimeSettingsResponse`
- `PluginRuntimeDocumentContentResponse`

These support runtime-token access to unmasked plugin-owned settings and request-scoped document content refs.

Phase 7 is complete for the first slot: action discovery/invocation schemas are implemented for `document.row.actions`.

Phase 8 is complete for license-target suggestions: stored generic suggestion schemas, target permission checks, target/field validation, selected-field acceptance, rejection, supersede behavior, line-item proposal storage, and reviewer audit details are implemented.

Phase 9 is complete for v1 slot contexts and pending suggestion storage for `license_draft`, `sourcing_item`, `pending_order_item`, and `pending_order_conversion`. Non-license target apply schemas remain future target-specific work.

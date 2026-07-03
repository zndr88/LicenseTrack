# Plugin Author Guide

This guide describes the LicenseTrack Plugin Host v1 contract for authors building installable plugin packages. The v1 host is intentionally conservative: plugins ship as offline zip packages, declare their permissions and actions in a manifest, run as managed local processes, and return structured results for LicenseTrack to review or apply through core services.

For the frozen v1 platform contract, see `docs/plugin-host-v1-roadmap.md`.

## What A Plugin Can Do In V1

A v1 plugin can:

- define metadata, compatibility, settings, permissions, capabilities, and actions in `plugin.ltplugin`;
- run as a managed process started by LicenseTrack;
- receive action requests from approved LicenseTrack UI slots;
- read its own settings through a host-provided secure channel;
- return user-visible summaries, errors, and reviewable suggestions.

A v1 plugin cannot:

- write directly to the LicenseTrack database;
- patch or replace compiled frontend files;
- inject arbitrary JavaScript into the browser;
- create its own database migrations;
- access data that was not included in the action context or allowed by permissions;
- save business changes without LicenseTrack review and core validation.

## Package Layout

Package the plugin as a `.zip` with these root entries:

```text
plugin.ltplugin
README.md
LICENSE
runtime/
```

Optional entries:

```text
NOTICE
assets/
docs/
checksums.txt
SIGNATURE
```

The `LICENSE` file is **your plugin's own license**, chosen by you — it is not the LicenseTrack license and is not expected to match it. Include a `NOTICE` file if your chosen license uses one (for example, Apache-2.0). See [Licensing Your Plugin](#licensing-your-plugin) below.

V1 package rules:

- The package must contain exactly one root `plugin.ltplugin`.
- `plugin.ltplugin`, `README.md`, `LICENSE`, and `runtime/` are required.
- Symlinks are rejected.
- Absolute paths are rejected.
- Path traversal such as `../` is rejected.
- Duplicate names after path normalization are rejected.
- The default maximum package size is 50 MiB.
- Runtime entrypoints must stay inside `runtime/`.

Use normalized relative paths with `/` separators inside the zip.

## Manifest Example

`plugin.ltplugin` is JSON. This example shows the shape expected for an AI-assisted document parser:

```json
{
  "manifestVersion": 1,
  "key": "licensetrack-ai",
  "name": "LicenseTrack AI",
  "version": "0.1.0",
  "publisher": {
    "name": "LicenseTrack",
    "url": "https://licensetrack.example"
  },
  "licenseTrack": {
    "minVersion": "1.1.0",
    "maxVersionExclusive": "2.0.0"
  },
  "description": "AI-assisted document parsing for LicenseTrack.",
  "runtime": {
    "type": "managedProcess",
    "entrypoint": "runtime/licensetrack_ai.py",
    "healthPath": "/health",
    "actionsBasePath": "/actions",
    "timeoutSeconds": 45,
    "startupTimeoutSeconds": 20
  },
  "permissions": [
    "documents:read",
    "plugin:settings:read",
    "suggestions:license_draft:write",
    "suggestions:sourcing_item:write",
    "suggestions:pending_order_item:write",
    "suggestions:pending_order_conversion:write",
    "actions:invoke"
  ],
  "permissionRationale": {
    "documents:read": "Reads selected quotes, purchase orders, invoices, and license documents when a user invokes Parse.",
    "plugin:settings:read": "Reads the configured AI provider API key and model.",
    "actions:invoke": "Receives Parse action requests from LicenseTrack."
  },
  "capabilities": [
    {
      "key": "licensetrack-ai.document-processing",
      "type": "document.processing",
      "description": "Parses selected uploaded documents and returns reviewable suggestions."
    }
  ],
  "settings": [
    {
      "key": "anthropicApiKey",
      "label": "Anthropic API Key",
      "type": "secret",
      "required": true,
      "helpText": "Stored encrypted by LicenseTrack and supplied only to this plugin runtime.",
      "order": 10
    },
    {
      "key": "model",
      "label": "Model",
      "type": "select",
      "required": true,
      "default": "claude-sonnet-4-20250514",
      "options": [
        "claude-sonnet-4-20250514"
      ],
      "order": 20
    }
  ],
  "actions": [
    {
      "key": "parseQuote",
      "label": "Parse Quote",
      "slot": "sourcing.item.edit.actions",
      "handler": "parse_quote",
      "requiredRole": "editor",
      "icon": "scanText",
      "description": "Extracts suggested sourcing item values from attached quote documents."
    },
    {
      "key": "parsePurchaseOrder",
      "label": "Parse PO",
      "slot": "pendingOrder.line.edit.actions",
      "handler": "parse_purchase_order",
      "requiredRole": "editor",
      "icon": "scanText"
    },
    {
      "key": "parsePendingOrderConversion",
      "label": "Parse Conversion",
      "slot": "pendingOrder.convert.actions",
      "handler": "parse_pending_order_conversion",
      "requiredRole": "editor",
      "icon": "scanText"
    },
    {
      "key": "parseLicenseDocument",
      "label": "Parse Document",
      "slot": "license.add.review.actions",
      "handler": "parse_license_document",
      "requiredRole": "editor",
      "icon": "scanText"
    }
  ]
}
```

## Deployment Constraints

These constraints apply to the host environment, not just plugin code. Authors should understand them when designing runtimes.

**Single-worker host.** LicenseTrack must run as a single Uvicorn worker (`--workers 1`, the default). Plugin subprocess handles and bearer tokens live in the FastAPI process. Multiple workers partition this state silently: one worker starts your subprocess and records its token; a second worker rejects all your runtime requests with 401. This is a host constraint — plugin authors cannot work around it. Document it in your plugin's README so operators understand the requirement.

**Python-only entrypoints.** Only `.py` entrypoints are supported in v1. The host rejects any plugin whose `runtime.entrypoint` does not end in `.py` at enable time. Do not declare `.sh`, `.exe`, or any other type.

**Document size limit.** The host will not deliver documents larger than `MAX_PLUGIN_DOCUMENT_SIZE_MB` (default 10 MB) to your runtime via the content endpoint. Your runtime should handle the case where a document ref is present but the content URL returns an error. If your use case requires larger files, the operator must raise this limit in their deployment configuration.

## Manifest Rules

Required top-level fields:

```text
manifestVersion
key
name
version
publisher
licenseTrack
runtime
permissions
```

Field rules:

- `manifestVersion` must be `1`.
- `key` must be a stable lowercase slug, 3-80 characters.
- `version` must be semantic version format.
- `publisher.name` is required.
- `licenseTrack.minVersion` is required.
- `licenseTrack.maxVersionExclusive` is optional but recommended.
- `runtime.type` must be `managedProcess`.
- `runtime.entrypoint` must be a relative path under `runtime/`.
- Permission names must appear in the v1 permission catalog.
- Action slots must appear in the v1 slot catalog.
- Setting keys and action keys must be unique per plugin.

## Permission Catalog

Request only the permissions needed for your actions.

| Permission | Use when your plugin needs to |
| --- | --- |
| `documents:read` | Read documents included in action context. |
| `documents:write` | Attach or create documents through approved core APIs. |
| `licenses:read` | Read license fields included in action context. |
| `procurement:read` | Read sourcing or pending-order fields included in action context. |
| `plugin:settings:read` | Read this plugin's own settings. |
| `plugin:settings:write` | Update this plugin's own settings. |
| `suggestions:license:write` | Create reviewable suggestions for existing licenses. |
| `suggestions:license_draft:write` | Create reviewable suggestions during add-license intake. |
| `suggestions:sourcing_item:write` | Create reviewable suggestions for sourcing items. |
| `suggestions:sourcing_quote_draft:write` | Create multi-line sourcing item suggestions from a parsed quote before saving. |
| `suggestions:pending_order_draft:write` | Create multi-line pending-order item suggestions from a parsed PO before saving. |
| `suggestions:pending_order_item:write` | Create reviewable suggestions for pending-order line items. |
| `suggestions:pending_order_conversion:write` | Create reviewable suggestions for pending-order conversion forms. |
| `actions:invoke` | Receive action invocations from LicenseTrack. |

Add `permissionRationale` entries so admins understand why each permission is requested.

## Settings

LicenseTrack renders plugin settings from the manifest. Supported setting types:

```text
text
secret
boolean
number
select
url
textarea
```

Secret settings are encrypted at rest, masked on read, redacted from audit logs, and preserved when the admin saves a masked placeholder.

Do not include defaults for secret settings.

## UI Slots

Plugins declare actions for approved slots. Core owns placement, layout, loading state, and error display.

| Slot | Target |
| --- | --- |
| `document.row.actions` | Existing uploaded document row. |
| `license.detail.actions` | Existing license. |
| `license.add.review.actions` | Draft license before save. |
| `sourcing.item.edit.actions` | Sourcing item edit workflow. |
| `sourcing.quote.add.actions` | Add-sourcing-request workflow (multi-item quote parse). |
| `pendingOrder.add.actions` | Add-pending-order workflow (multi-item PO parse). |
| `pendingOrder.line.edit.actions` | Pending-order line edit workflow. |
| `pendingOrder.convert.actions` | Pending-order conversion workflow. |

`settings.plugins.panel` is reserved for core-rendered plugin settings and diagnostics. Plugins do not declare actions for it in v1.

## Runtime Protocol

V1 runtimes are managed local HTTP processes. LicenseTrack starts the process and injects:

```text
LT_PLUGIN_KEY
LT_PLUGIN_VERSION
LT_PLUGIN_PORT
LT_PLUGIN_TOKEN
LT_PLUGIN_BASE_URL
LT_PLUGIN_SETTINGS_URL
LT_PLUGIN_DOCUMENTS_BASE_URL
LT_PLUGIN_LOG_DIR
```

Bind only to `127.0.0.1:{LT_PLUGIN_PORT}`. Require `Authorization: Bearer {LT_PLUGIN_TOKEN}` for every request.

`LT_PLUGIN_SETTINGS_URL` points to a runtime-token endpoint:

```http
GET /api/plugin-runtime/{pluginKey}/settings
Authorization: Bearer <LT_PLUGIN_TOKEN>
```

It returns this plugin's own setting values, including unmasked secret values, and never returns another plugin's settings:

```json
{
  "pluginKey": "licensetrack-ai",
  "values": [
    {
      "key": "anthropicApiKey",
      "value": "sk-ant-...",
      "required": true,
      "configured": true
    }
  ],
  "missingRequired": []
}
```

Health endpoint:

```http
GET /health
Authorization: Bearer <token>
```

Health response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "details": {}
}
```

Action endpoint:

```http
POST /actions/{handler}
Authorization: Bearer <token>
Content-Type: application/json
```

Action request:

```json
{
  "actionKey": "parseQuote",
  "handler": "parse_quote",
  "pluginKey": "licensetrack-ai",
  "requestId": "uuid",
  "actor": {
    "id": 1,
    "role": "admin"
  },
  "context": {
    "targetType": "sourcing_item",
    "targetId": 123,
    "sourcingRequestId": 42,
    "sourcingItemId": 123,
    "quoteDocumentIds": [
      456
    ],
    "userRole": "admin",
    "runtimeAccess": {
      "settingsUrl": "http://127.0.0.1:8000/api/plugin-runtime/licensetrack-ai/settings",
      "documentRefs": [
        {
          "type": "sourcing_quote_document",
          "id": 456,
          "contentUrl": "http://127.0.0.1:8000/api/plugin-runtime/licensetrack-ai/action-requests/uuid/documents/sourcing_quote_document/456"
        }
      ]
    }
  }
}
```

`runtimeAccess.documentRefs` contains only documents that core included in the current action context. The `contentUrl` is valid only while that action request is running and requires `Authorization: Bearer {LT_PLUGIN_TOKEN}`.

Document content response:

```json
{
  "documentType": "sourcing_quote_document",
  "documentId": 456,
  "fileName": "quote.txt",
  "contentType": "text/plain",
  "sizeBytes": 1234,
  "contentBase64": "...",
  "text": "Plain text when the file is text-like, otherwise null"
}
```

Success response:

```json
{
  "status": "ok",
  "summary": "Detected 3 license lines.",
  "suggestions": [
    {
      "targetType": "sourcing_item",
      "targetId": 123,
      "summary": "Suggested publisher and product values.",
      "confidence": 0.91,
      "fields": [
        {
          "field": "publisherName",
          "value": "Example Publisher",
          "confidence": 0.91,
          "source": "Page 1"
        }
      ],
      "lineItems": [],
      "rawOutput": {}
    }
  ],
  "rawOutput": {}
}
```

Error response:

```json
{
  "status": "error",
  "error": {
    "code": "provider_unavailable",
    "message": "The provider could not be reached.",
    "retryable": true,
    "details": {}
  }
}
```

## Suggestions

Plugins return suggestions; LicenseTrack stores them as pending review records. Users choose which fields to accept, and core applies accepted fields through normal services.

Supported v1 targets:

```text
license
license_draft
sourcing_item
sourcing_quote_draft
pending_order_draft
pending_order_item
pending_order_conversion
```

Suggestion rules:

- Unknown targets are rejected.
- Unknown fields are rejected.
- Lifecycle and internal identity fields are rejected.
- Suggestions do not mutate records until accepted.
- A newer pending suggestion may supersede older pending suggestions for the same plugin, action, and target.
- Audit records include plugin, action, target, reviewer, decision, and applied fields.

## Licensing Your Plugin

**You choose your plugin's license.** A plugin is not part of LicenseTrack and does not inherit the LicenseTrack license. Under Section 2.2 of the [LicenseTrack Source-Available License](../LICENSE), Plugins, Extensions, and Integrations *"may be released under any license terms You choose, including proprietary or commercial terms."*

This means you can release your plugin as open source (MIT, Apache-2.0, etc.), keep it proprietary, or sell it. The choice is yours and is independent of how LicenseTrack itself is licensed.

To qualify as a Plugin under Section 2.2 (and therefore be free of the host license's distribution restrictions), your plugin must:

- **not reproduce or incorporate a substantial portion of the LicenseTrack source code** — interface only through the documented manifest, runtime protocol, permissions, and slots described in this guide;
- **be genuinely additive** — extend or connect to LicenseTrack rather than replace or repackage its core functionality;
- **not constitute, in combination with other components, a functional equivalent of LicenseTrack offered to third parties as a service.**

Because the runtime protocol in this guide is the entire integration surface, a normal plugin satisfies these conditions automatically.

### Required package files

- **`LICENSE`** — your plugin's own license text. The host installer requires this file but does not parse or enforce its contents; it documents *your* terms to operators.
- **`NOTICE`** — include if your license expects one (Apache-2.0 does). This is the natural place to state that your plugin is licensed separately from LicenseTrack.

### Attribution

Section 6 of the LicenseTrack license asks that a plugin's documentation acknowledge it is **designed to work with LicenseTrack**. You are **not** required to reproduce the LicenseTrack license in your plugin. A line in your `README.md` or `NOTICE` is sufficient.

### Reference plugin

The first-party **LicenseTrack AI** plugin is the canonical example. It is maintained in a separate repository and released under **Apache-2.0** — deliberately a different license from LicenseTrack — demonstrating the separation described above. Use its `LICENSE`, `NOTICE`, and `README.md` as a template for your own package.


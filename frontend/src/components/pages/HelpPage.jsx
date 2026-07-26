import React, { useMemo, useState } from "react";
import Icon from "../ui/Icon.jsx";

const HELP_ARTICLES = [
  {
    id: "procurement-flow",
    category: "Workflows",
    title: "Procurement flow",
    summary: "Move requests through the purchasing route that matches the entitlement and support being acquired.",
    sections: [
      {
        heading: "Flow",
        body: [
          "Sourcing is the quote-stage workspace. A sourcing request can hold one or more license lines, quote evidence, supplier details, notes, and renewal context.",
          "License Type is optional on sourcing lines. A zero-cost Freeware / Open Source line converts directly to an active Registry license, preserving its sourcing relationship and Request Date without creating a pending order, Purchase Date, PO, invoice, or purchase price.",
          "Perpetual, OEM, and Freeware / Open Source lines can classify support as unknown, not applicable, included, or separately tracked. Included support can use one flat coverage fee or covered quantity multiplied by support unit price. Separately tracked support creates a linked maintenance line with its own procurement lifecycle.",
          "When a purchase is ready for a PO, convert the sourcing request to a pending order. Pending orders keep the PO-level context and editable line items until the order is fulfilled.",
          "When the licenses are ready to enter the portfolio, convert the pending order. Each line becomes a license record, procurement evidence is retained, the actual delivered entitlement and support dates are confirmed, and converted orders are locked.",
          "History buttons on Sourcing Overview and Pending Orders open second, read-only tables below the active work. Converted and cancelled records stay searchable there without cluttering the live pipeline.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "Quote documents belong to sourcing until conversion, then become pending-order procurement evidence.",
          "PO documents and invoices are shared by licenses created from the same pending order.",
          "A reused PO number does not share documents across unrelated pending orders.",
          "Sourcing history can link forward to the related pending order, including converted pending orders that now live in PO history.",
          "Pending order history can link forward to created licenses. For multi-line orders, expand the order and use View License on the line.",
          "Maintenance lines require an explicit perpetual, OEM, or freeware/open-source parent during conversion.",
          "Mixed requests are item-aware: paid lines follow the pending-order path, while Freeware / Open Source lines retain their direct Registry conversion.",
          "Freeware with positive included-support cost follows the pending-order path because the support purchase still needs ordinary procurement evidence.",
          "Included support contributes to sourcing and pending-order totals once. Separately tracked support contributes through its own maintenance line.",
          "Support cost describes the selected coverage period and is not automatically annualized. A renewal creates a new line for the new period.",
        ],
      },
    ],
  },
  {
    id: "renewal-workflow",
    category: "Workflows",
    title: "Renewal workflow",
    summary: "Start renewals, track predecessor and successor records, and handle coterm opportunities.",
    sections: [
      {
        heading: "Flow",
        body: [
          "The renewal workbench surfaces licenses approaching expiry and flags records that need attention, such as missing documents or high value.",
          "Starting a renewal marks the current license as pending renewal and creates sourcing-stage work. The successor license is not created until the related pending order is converted.",
          "When conversion completes, LicenseTrack creates the successor, marks the predecessor renewed, and preserves the renewal chain.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "Renewal successors inherit the predecessor license reference.",
          "Cancel renewal work before it reaches a pending order when the purchasing motion changes.",
          "Coterm renewals merge multiple renewal lines so several predecessor licenses can align to one successor period.",
        ],
      },
    ],
  },
  {
    id: "license-registry",
    category: "Feature reference",
    title: "License registry",
    summary: "Search, filter, edit, and review the full software license portfolio.",
    sections: [
      {
        heading: "How it works",
        body: [
          "The License Overview table is the central portfolio registry. It supports search, status filters, a toolbar column-category selector for Standard, Advanced, Computed, and Custom Field list columns, saved views, Current View and Full Data CSV exports, and inline edits for common fields.",
          "Opening a license shows the detail panel with fields, custom fields, documents, notes, maintenance actions, renewal actions, contract links, and a History section with creator timestamps plus linked procurement trail records when available.",
        ],
      },
      {
        heading: "Standard fields",
        bullets: [
          "LT Ref: LicenseTrack's automatically assigned entitlement-chain reference. Renewal successors keep the same reference so related records remain traceable.",
          "External Ref: an optional identifier from another system, import source, or internal administration process.",
          "Publisher and Description: identify the software product and the organization that publishes it.",
          "Contract #, PO #, and Invoice #: commercial references used to reconcile the license with contracts, purchase orders, and invoices. A license can hold multiple invoice numbers; the first invoice is treated as the primary value shown in the table and CSV exports.",
          "Supplier: the reseller or vendor that supplied the license. Leave empty for a direct publisher purchase.",
          "Department and Budget Owner: identify the internal owner. The budget-owner email receives renewal notifications when configured and when the license's renewal notifications flag is enabled.",
          "Publisher Contact: the external contact email used for publisher communication.",
          "Type: the license model, such as subscription, perpetual, maintenance, SaaS, OEM, or freeware.",
          "Metric and Purchase Quantity: the metric describes how entitlement usage is counted, such as per user, per device, or enterprise-wide; Purchase Quantity is the quantity as purchased on the order. Effective or per-unit quantities live downstream in your SAM tool or in custom fields.",
          "SKU: the publisher or supplier product code used to identify the purchased item.",
          "Unit Price, Total PO Value, and Currency: retain acquisition values. Unit Price is line-level acquisition pricing; Total PO Value is computed from license rows sharing a PO number. Freeware/open-source acquisition pricing is zero, while paid support remains separately visible under Maintenance / Support.",
          "Start Date and End Date: the active entitlement period. Perpetual licenses deliberately have no end date.",
          "Request Date: when the originating sourcing item was created. It marks the beginning of the procurement request.",
          "Purchase Date: the actual purchase milestone confirmed by the license manager during pending-order conversion. It is not inferred from the date the pending order was created.",
          "Portal URL: the service or administration URL for a SaaS license.",
          "Notes: free-form operational context. Notes are shortened visually in the table but exported in full.",
        ],
      },
      {
        heading: "Advanced and computed fields",
        bullets: [
          "Created By: the account that created the license record. It can fall back to email, user ID, or a legacy label when the original account is unavailable.",
          "Created: when the license record itself was created in LicenseTrack. This differs from Request Date and Purchase Date: those fields preserve the earlier procurement history.",
          "Last Updated: when the license record was most recently changed.",
          "Lifecycle Status: LicenseTrack workflow metadata, such as pending_renewal, renewed, or legacy. It supplements the calculated expiration state.",
          "Sync Status: integration metadata describing synchronization with an external system. It is normally empty when no external integration manages the record.",
          "Last Synced: the most recent recorded synchronization timestamp for an external integration.",
          "Maintenance / Support Coverage: classifies support as unknown, not applicable, included, or separately tracked. Included support stays on the parent; separately tracked support uses a linked maintenance license.",
          "Maintenance Start and End: identify the support coverage period. For separately tracked support, the parent mirrors the active maintenance license's dates.",
          "Maintenance Pricing Basis, Covered Quantity, Support Unit Price, and Support Cost: describe included support as either one flat coverage fee or a per-unit calculation. Support Cost is the total for the coverage period, not an automatically annualized amount.",
          "Docs: the number of visible license-owned and procurement documents associated with the record.",
          "Calc. Total: quantity multiplied by unit price for the individual license row.",
          "Expiration: a calculated label derived from lifecycle state, start date, and end date, such as Upcoming, Active, Expiring, Expired, Perpetual, Renewed, or Legacy.",
          "Complete: the calculated percentage of admin-required fields and evidence currently present on the record.",
          "Custom Fields: organization-specific fields created by an admin. Their meaning depends on the field definition configured for this installation.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "Perpetual licenses are not incomplete for missing an end date.",
          "For a direct freeware or open-source record, use the ordinary Add License form and choose Freeware / Open Source as the License Type. EULA, proof-of-entitlement, and publisher-contact completeness checks do not apply. Contract, PO, invoice, and quote checks also do not apply unless paid included support is present. Department and budget owner requirements still apply.",
          "Annual cost totals are active recurring-cost rollups: active, perpetual-status, and expiring subscription, SaaS, maintenance, and current paid included-support costs are included; zero-cost freeware and upcoming, expired, retired, renewed, and legacy records are excluded.",
          "Request Date preserves sourcing-item creation history, including direct freeware conversion. Purchase Date is added only when a pending order exists. Both can also be edited to enrich imported or legacy records.",
          "Click the Invoice # value or add control in Key Dates & Contract to manage multiple invoice numbers. Reorder the list to choose which invoice appears as the primary invoice in the Registry and exports.",
          "The identity header shows the external reference next to the LT reference when an external reference exists.",
          "The History section shows the creator account name, record creation timestamp, last-update timestamp, and the Procurement Trail linking back to sourcing and pending-order history when those source records exist.",
          "Inline editing is for quick field corrections; use the detail panel for full review.",
          "Deleting a license permanently removes its license-owned documents.",
        ],
      },
    ],
  },
  {
    id: "csv-import",
    category: "Feature reference",
    title: "CSV import",
    summary: "Bulk-load license records from LicenseTrack templates or exported spreadsheet data.",
    sections: [
      {
        heading: "How it works",
        body: [
          "CSV Import analyzes headers and sample values before anything is written. Native Import automatically recognizes existing custom fields by their stable cf_* key or an unambiguous field name. If a file needs manual mapping, the mapping step lets you assign columns to native or existing custom fields; admins can also create a new custom field.",
          "The import number format defaults to the user's personal format and is shown as a rendered example: 1,234.50, 1.234,50, or 1 234,50. It can be overridden for one file without changing the account preference.",
          "Preview classifies each row, surfaces warnings, checks for duplicates, and lets you skip or restore rows before confirmation.",
          "When the preview contains inferred maintenance parents or possible duplicates, LicenseTrack shows a warning summary and requires explicit acknowledgement before importing. Invalid types, metrics, dates, and numeric values are row errors instead.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "When an LT Ref column is present, Native and External Tool imports offer an auto-enabled option to update the current matching record instead of creating a duplicate. Turning it off keeps create-only behavior.",
          "Maintenance parent references must resolve before import, unless LicenseTrack can infer a clear parent from the same file.",
          "Currency defaults are reported as informational warnings; by themselves they do not require acknowledgement.",
          "CSV imports are audited with inserted, updated, skipped, error, warning-summary, custom-field failure, and acknowledgement details.",
          "For non-maintenance rows, parent_license_ref is treated as a renewal predecessor reference.",
          "license_ref is a chain identity, not a unique row key. Renewal successors inherit the predecessor's reference, so the same license_ref can appear on more than one row across a renewal chain. Use the record id from exports or API responses when you need to identify a specific database row.",
          "Saved mapping profiles are shared: editors can load them, while admins can create, rename, replace, or delete them.",
          "Export Full Data uses stable custom-field keys as CSV headers, so custom values can be edited and re-imported through Native Import even if a field's display name is later changed.",
        ],
      },
    ],
  },
  {
    id: "documents",
    category: "Feature reference",
    title: "Documents and evidence",
    summary: "Understand license-owned documents, procurement evidence, and document sharing rules.",
    sections: [
      {
        heading: "Document scopes",
        body: [
          "License-owned documents attach to one license and include evidence such as EULAs, entitlement certificates, and other supporting files.",
          "Procurement documents include Quote, Purchase Order, and Invoice evidence. These can be scoped to a license or to the pending order that created a group of licenses.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "PO number is metadata, not the document-sharing key.",
          "Procurement documents are shared across licenses from the same pending order.",
          "Documents are stored on the server filesystem under the configured storage path.",
          "If a database-only restore is used before document storage is restored, document records remain visible and affected rows are marked File missing or Storage unavailable until the managed files are available again.",
          "Editors and admins can request document processing from the document row when an active document processor webhook is configured and a document.processing integration capability is available. This sends an audited event for configured integrations; LicenseTrack does not process the document by itself, and this is not an Official Extension action.",
          "When an external processor submits suggested values, pending suggestions appear in the Documents section. Editors and admins can compare current and suggested values, accept selected fields, or reject the result without changing the license.",
          "Database backups do not include uploaded documents.",
        ],
      },
    ],
  },
  {
    id: "contracts",
    category: "Feature reference",
    title: "Contracts",
    summary: "Group agreement records by publisher, link licenses, and organize contract documents.",
    sections: [
      {
        heading: "How it works",
        body: [
          "Contracts keep agreement-level information separate from individual license evidence. Each contract records its publisher and contract number and can be linked to one or more license records.",
          "Contract numbers are matched case-insensitively, so CN-123 and cn-123 are treated as the same contract identity.",
          "Contract documents can be organized into folders so amendments, schedules, signatures, and supporting material remain grouped with the agreement rather than one license row.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "Contract files belong on the contract record; invoices, quotes, purchase orders, EULAs, and entitlement evidence normally belong to license or procurement document scopes.",
          "Deleting a contract removes its stored contract documents and unlinks affected licenses; the license records themselves remain.",
          "Contract document folders are organizational only and do not change record access permissions.",
          "Viewer visibility follows the licenses and departments the viewer is allowed to see, using case-insensitive contract-number matching.",
        ],
      },
    ],
  },
  {
    id: "reports",
    category: "Feature reference",
    title: "Reports",
    summary: "See how portfolio analytics, spend totals, forecasts, and exports are calculated.",
    sections: [
      {
        heading: "How it works",
        body: [
          "Reports combines a server-computed portfolio annual-cost rollup with client-side analysis of visible license records. Viewer users only see reporting data for their assigned departments.",
          "The date-range filter is based on license start dates. Filters apply across spend, publisher and vendor overview, portfolio health, forecast, and renewal calendar.",
          "Date-only license values are treated as local calendar dates, so records on quarter or year boundaries stay in the expected period regardless of browser UTC offset.",
          "The Upcoming, Active, Expiring, and Expired counters reflect the currently filtered report rows. Upcoming is separate from Active. The portfolio annual-cost chip remains a portfolio-wide active recurring-cost rollup.",
        ],
      },
      {
        heading: "Calculation notes",
        bullets: [
          "Historical PO spend uses total PO price and de-duplicates by PO number when possible. Zero-cost freeware without paid support does not contribute and is not treated as an unpriced purchase.",
          "Lifecycle budget groups line-level calculated value into active, expiring, and expired records using the same status as License Overview. Upcoming records are counted separately in the summary and stay out of active budget until their start date arrives. Calculated value uses quantity multiplied by unit price when available, with total PO price as a fallback.",
          "The Publisher & Vendor Overview combines a publisher chart with a sortable publisher/supplier table using the same calculated-value rule.",
          "Recurring annual cost covers active subscription, SaaS, maintenance, and current paid included support on freeware, perpetual, or OEM parents. Included-support cost is the stored coverage-period total and is not prorated or annualized. Expired and not-yet-started coverage is excluded.",
          "The budget forecast excludes upcoming, expired, retired, renewed, legacy, and pending-renewal records.",
          "The renewal calendar covers the next four configured fiscal quarters and excludes upcoming, expired, and renewed records.",
          "Records without usable pricing are counted but excluded from calculated totals.",
          "PDF export captures the visible report sections.",
        ],
      },
    ],
  },
  {
    id: "admin-operations",
    category: "Admin and operations",
    title: "Admin and operations",
    summary: "Configure users, settings, notifications, authentication, database backup, restore, portfolio reset, and audit controls.",
    sections: [
      {
        heading: "Admin areas",
        body: [
          "Admins manage users, roles, viewer department scope, download permission, global settings, SMTP, OIDC, mandatory fields, database backup settings, restore, portfolio reset, and audit history.",
          "Admin Settings is grouped into General, Integrations, and Operations so routine configuration stays separate from API, webhook, integration capability, database backup, restore, and reset work.",
          "My Settings remains user-specific and covers personal preferences such as display currency, number/date/time formats, time zone, session timeout, appearance, and saved license views.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "At least one active local admin must always exist.",
          "The first admin is the protected break-glass admin.",
          "SMTP passwords and OIDC client secrets are stored encrypted and returned as masked placeholders.",
          "Changing mandatory fields immediately changes completeness calculations when records are reloaded.",
          "The expiry alert window is shared by Registry badges, statistics, exports, reports, contracts, renewal and maintenance responses, and notifications.",
          "Completeness requirements are opt-in. Admins can phase in ownership, commercial-reference, and evidence requirements as legacy records are improved.",
          "Completeness & Flags includes a per-license Renewal notifications toggle. It is enabled by default and can be turned off for active licenses that should not send expiry emails, without removing the budget owner email or marking the record retired or legacy.",
          "Number-format choices are labeled by the rendered pattern instead of a country. CSV Import starts with that personal choice but can override it for one source file.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    category: "Admin and operations",
    title: "Notifications and email",
    summary: "Configure renewal alerts, recipients, delivery timing, and per-license suppression.",
    sections: [
      {
        heading: "How it works",
        body: [
          "The daily notification run evaluates visible lifecycle and completeness conditions, creates in-app notifications, and optionally sends SMTP email when email notifications are enabled.",
          "Admins configure the alert window, notification hour, manager digest recipient, allowed recipient domains, SMTP settings, and email template text. A test email checks SMTP without running the full notification workflow.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "Renewal emails require a budget-owner email and an enabled Renewal notifications flag on the license.",
          "The per-license Renewal notifications toggle suppresses expiry email for that record without retiring it or removing its owner.",
          "Trigger notifications now runs the real notification workflow and can send real messages; use Send test email for SMTP-only validation.",
          "The allowed-domain list applies to scheduled and manually triggered notification recipients.",
        ],
      },
    ],
  },
  {
    id: "audit-log",
    category: "Admin and operations",
    title: "Audit log",
    summary: "Search and export authentication, configuration, document, and record-change history.",
    sections: [
      {
        heading: "How it works",
        body: [
          "The audit log records security-sensitive and data-changing events, including authentication, user and settings changes, procurement and license mutations, document amendments, backup and restore actions, API-token activity, and webhook-related events.",
          "Admins can search and filter the log, inspect structured event detail, and export results for investigation or retention outside LicenseTrack.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "API-token changes record both the owning admin and token identity so integration activity can be isolated.",
          "Webhook events are derived from durable audited product events rather than UI clicks.",
          "Audit retention is configurable. Export records before pruning when policy requires longer retention.",
          "The audit log supports investigation but does not replace centralized application and reverse-proxy logs.",
        ],
      },
    ],
  },
  {
    id: "backup-restore",
    category: "Admin and operations",
    title: "Database backup and restore",
    summary: "Create SQLite database snapshots and restore database rows with a pre-restore safety snapshot.",
    sections: [
      {
        heading: "How it works",
        body: [
          "LicenseTrack uses SQLite online backup to create a consistent database snapshot, compresses it, stores it in the configured database backup directory, and prunes old database backups according to retention settings.",
          "Restore offers two sources: select a validated archive already stored in the configured server backup directory, or upload an off-host archive from the administrator's computer.",
          "During a routine database restore, LicenseTrack validates the SQLite database, creates a pre-restore database safety snapshot, replaces the live database, and may restart the process depending on server configuration.",
          "A database-only restore preserves database records and configuration only. Managed document metadata may point at files that are not yet restored, unavailable, or in a misconfigured storage path; LicenseTrack reports those files as missing or unavailable instead of deleting metadata.",
          "Portfolio-recovery and pre-restore safety archives contain managed documents as well. LicenseTrack creates a fresh database-and-document safety archive, restores both data stores, and rolls document folders back if database restoration fails.",
        ],
      },
      {
        heading: "Important",
        bullets: [
          "Routine application database backups include the database only.",
          "Uploaded documents are data files on disk and must be backed up separately from the storage directory or full data volume.",
          "The database backup directory must exist or have a creatable parent path.",
          "Server restore accepts only archives listed from the configured backup directory; arbitrary server paths are never accepted.",
        ],
      },
      {
        heading: "Reset portfolio data",
        body: [
          "Reset Portfolio Data is intended for clearing imports and test activity before go-live. It deletes current and historical licenses, sourcing requests and items, pending orders, contracts, associated documents, processing results, webhook delivery history, and prior audit events.",
          "Before deletion, LicenseTrack creates and verifies a separate recovery archive containing a WAL-safe database snapshot plus managed license, sourcing, procurement, and contract documents. The reset is blocked if this archive cannot be created. That server-side archive can later be selected in Restore Database to recover both database rows and managed documents.",
        ],
        bullets: [
          "Users, roles, personal and global settings, custom-field definitions, import mappings, API tokens, webhook definitions, integrations, Official Extensions, and existing backup files are preserved.",
          "The next generated license reference restarts at LT-REF-00001. Internal database IDs are not reset.",
          "The prior audit log is replaced by one system.portfolio_reset event containing the archive name and deleted record counts.",
          "Only an admin session can execute the reset, and the exact RESET PORTFOLIO confirmation phrase is required.",
        ],
      },
    ],
  },
  {
    id: "api-tokens",
    category: "Admin and operations",
    title: "API tokens and integrations",
    summary: "Create scoped bearer tokens for scripts, automation, and system integrations.",
    sections: [
      {
        heading: "How it works",
        body: [
          "Admins create API tokens from Admin Settings. Each token has a name and one or more scopes that control which route families it can use.",
          "Use API tokens as bearer credentials for machine-to-machine calls, for example Authorization: Bearer lt_...",
          "License read responses include customFields inline, including each field definition and stable fieldKey, so integrations can read configured custom-field values from license API results.",
          "Webhook endpoints can be managed from Admin Settings to notify internal systems about audited LicenseTrack events. Receivers should use webhook events as notifications and call the API for current record state.",
          "Integrations and sidecars can declare capabilities such as document.processing through the API. Admin Settings shows their status, version, last-seen time, and any reported error. Capability records are status declarations; they do not load UI or runtime code.",
          "Integration authors should start with docs/extension-authors/overview.md and docs/extension-authors/build-integrations.md for boundaries, scope selection, examples, and operational guidance. Document processor authors should use docs/extension-authors/build-document-processor.md.",
          "Document actions can be used with webhooks so an external service can process a selected uploaded document on demand. The document action appears only when an active webhook subscribes to document_action.requested or all events and a document.processing capability is available.",
          "Document processors can submit extracted values back as pending results. LicenseTrack stores them for review, shows recent processing history, and marks documents that have pending or reviewed processor output. Selected accepted suggestions apply supported license fields and existing custom fields through core update paths.",
          "Document processing suggestions are limited to patchable license fields and existing custom fields. Lifecycle repair fields, procurement conversion state, and internal fields such as id and license_ref are never accepted. If a suggestion targets an excluded field, the entire accept call fails without applying any suggestion.",
          "LicenseTrack does not support arbitrary third-party in-process packages, runtime React loading, or arbitrary modal/page injection. Custom automation should use API tokens, webhooks, and sidecars.",
          "When enabled by the server operator, Admin Settings can show Official Extensions published and signed by the LicenseTrack project. Official Extensions run as trusted server code and must be installed only from official LicenseTrack release channels. Developer packages are not verified or supported in production.",
          "If the same processor submits a newer pending result for the same document, older pending results are superseded so reviewers see the latest proposal.",
          "license_ref is a chain identity shared across a renewal successor chain, not a unique row key. Use the record id from API responses when referencing a specific database row in integrations or external systems.",
        ],
      },
      {
        heading: "Important",
        bullets: [
          "Copy and save the raw token when it is created. LicenseTrack cannot show it again after dismissal.",
          "Create one token per integration or automation job and grant only the scopes it needs.",
          "Read-only license tokens can read license records but cannot create, update, or delete them.",
          "API tokens are not accepted for admin settings, user management, database backup, restore, authentication, or token-management routes.",
          "For local webhook or sidecar testing, confirm the receiver port is free before using it. If a health check returns 426 Upgrade Required or another unexpected response, choose another port and update the webhook URL.",
          "Revoking a token immediately stops integrations that use it.",
        ],
      },
    ],
  },
  {
    id: "roles-access",
    category: "Admin and operations",
    title: "Roles and access",
    summary: "Understand Admin, Editor, Viewer, department scope, downloads, and authentication behavior.",
    sections: [
      {
        heading: "Roles",
        bullets: [
          "Admin: full access, including users, global settings, database backups, restore, and audit log.",
          "Editor: create, edit, upload, convert, and delete operational records, but no admin settings.",
          "Viewer: read-only access, limited to assigned departments.",
        ],
      },
      {
        heading: "Things to know",
        bullets: [
          "A viewer with no departments assigned sees no records.",
          "Viewer department options are limited to assigned departments that have visible licenses. Exact duplicate department assignments are removed when saved, while different casing remains distinct.",
          "Download permission is controlled per user.",
          "OIDC and local login can coexist.",
          "OIDC users do not have a usable local password unless converted by an admin.",
        ],
      },
    ],
  },
  {
    id: "glossary",
    category: "Glossary",
    title: "Glossary",
    summary: "Common terms used throughout LicenseTrack.",
    sections: [
      {
        heading: "Portfolio terms",
        bullets: [
          "Completeness: the percentage of required license fields and evidence that are present.",
          "Renewal notifications: a per-license flag that controls whether expiry emails are sent for that license. It is enabled by default.",
          "Primary invoice: the first invoice number on a license. It is the value shown in the Registry table and standard exports when multiple invoice numbers are recorded.",
          "Predecessor: the existing license being renewed.",
          "Successor: the license record created by completing a renewal.",
          "Procurement bundle: pending-order-scoped evidence shared by licenses from the same pending order.",
          "Procurement trail: the linked source records shown in License Details > History, connecting a license back to its sourcing request, sourcing line, and pending order. Procurement documents remain available in their dedicated document and workflow-history views.",
        ],
      },
      {
        heading: "Workflow terms",
        bullets: [
          "Sourcing request: quote-stage procurement parent.",
          "Sourcing history: the read-only converted/cancelled sourcing table shown below active sourcing when History is enabled.",
          "Pending order: PO-stage procurement parent.",
          "Pending order history: the read-only converted/cancelled PO table shown below active pending orders when History is enabled.",
          "Coterm renewal: a renewal that aligns several predecessor licenses to one successor period.",
          "Break-glass admin: the protected local admin account retained for recovery.",
        ],
      },
    ],
  },
];

const CATEGORY_ORDER = ["Workflows", "Feature reference", "Admin and operations", "Glossary"];

function articleText(article) {
  return [
    article.title,
    article.summary,
    article.category,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...(section.body ?? []),
      ...(section.bullets ?? []),
    ]),
  ].join(" ").toLowerCase();
}

function searchScore(article, q) {
  if (!q) return 0;
  const title = article.title.toLowerCase();
  const summary = article.summary.toLowerCase();
  if (title === q) return 0;
  if (title.includes(q)) return 1;
  if (summary.includes(q)) return 2;
  return 3;
}

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedId, setSelectedId] = useState("procurement-flow");

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return HELP_ARTICLES.filter((article) => {
      const categoryMatch = selectedCategory === "All" || article.category === selectedCategory;
      const searchMatch = !q || articleText(article).includes(q);
      return categoryMatch && searchMatch;
    }).sort((a, b) => searchScore(a, q) - searchScore(b, q));
  }, [query, selectedCategory]);

  const selectedArticle = useMemo(() => {
    return filteredArticles.find((article) => article.id === selectedId) ?? filteredArticles[0] ?? HELP_ARTICLES[0];
  }, [filteredArticles, selectedId]);

  const categoryCounts = useMemo(() => {
    return HELP_ARTICLES.reduce((counts, article) => {
      counts[article.category] = (counts[article.category] ?? 0) + 1;
      return counts;
    }, {});
  }, []);

  return (
    <>
      <div className="page-header help-header">
        <div>
          <h2>Help Center</h2>
          <p>Workflow guidance, feature notes, and operating caveats for this LicenseTrack install.</p>
        </div>
        <div className="help-search-wrap">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help..."
            aria-label="Search help"
          />
        </div>
      </div>

      <div className="help-layout">
        <aside className="help-rail" aria-label="Help categories">
          <button
            type="button"
            className={`help-category${selectedCategory === "All" ? " active" : ""}`}
            onClick={() => setSelectedCategory("All")}
          >
            <span>All</span>
            <span>{HELP_ARTICLES.length}</span>
          </button>
          {CATEGORY_ORDER.map((category) => (
            <button
              key={category}
              type="button"
              className={`help-category${selectedCategory === category ? " active" : ""}`}
              onClick={() => setSelectedCategory(category)}
            >
              <span>{category}</span>
              <span>{categoryCounts[category] ?? 0}</span>
            </button>
          ))}
        </aside>

        <section className="help-list" aria-label="Help articles">
          {filteredArticles.length === 0 ? (
            <div className="help-empty">
              <Icon name="info" size={18} />
              <span>No help articles match that search.</span>
            </div>
          ) : (
            filteredArticles.map((article) => (
              <button
                key={article.id}
                type="button"
                className={`help-card${selectedArticle.id === article.id ? " active" : ""}`}
                onClick={() => setSelectedId(article.id)}
              >
                <span className="help-card-kicker">{article.category}</span>
                <span className="help-card-title">{article.title}</span>
                <span className="help-card-summary">{article.summary}</span>
              </button>
            ))
          )}
        </section>

        <article className="help-article">
          <div className="help-article-kicker">{selectedArticle.category}</div>
          <h3>{selectedArticle.title}</h3>
          <p className="help-article-summary">{selectedArticle.summary}</p>

          {selectedArticle.sections.map((section) => (
            <section key={section.heading} className="help-article-section">
              <h4>{section.heading}</h4>
              {(section.body ?? []).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </div>
    </>
  );
}

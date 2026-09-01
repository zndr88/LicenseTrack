import { buildLicense, buildSeedData, computeExpirationStatus } from "./fixtures.js";
import {
  applyBundledIncludedSupportDefaults,
  defaultMaintenanceCoverage,
  isBundledIncludedSupport,
  withDefaultMaintenanceCoverage,
} from "./supportDefaults.js";
import { daysUntil } from "./time.js";
import { sumCanonicalQuantities } from "../utils/quantity.js";

/** Module-level in-memory state. Refresh or logout wipes it - that IS the reset story. */
export const store = {
  licenses: [],
  contracts: [],
  contractDocuments: [],
  sourcingItems: [],
  sourcingRequests: [],
  pendingOrders: [],
  organizations: [],
  costCentres: [],
  userDepartments: {},
  userSettings: {},
  globalSettings: {},
  seeded: false,
  _nextId: 1000,
};

const DEFAULT_USER_SETTINGS = {
  visible_in_list: {},
  visible_in_detail: {
    supplier: true,
    costCentre: true,
    licenseType: true,
    licenseMetric: true,
    quantity: true,
    skuCode: true,
    unitPrice: true,
    totalPoPrice: true,
    notes: true,
    licenseRef: true,
  },
  theme: "light",
  ui_size: "normal",
  display_currency: "EUR",
  number_format_locale: "en-US",
  date_format: "DD/MM/YYYY",
  time_format: "24h",
  time_zone: "UTC",
  column_order: [],
  saved_views: [],
  renewal_workbench_columns: {},
  sidebar_collapsed: false,
};

const DEFAULT_GLOBAL_SETTINGS = {
  mandatory_fields: {
    invoice: false,
    eula: false,
    entitlement: false,
    purchaseOrder: false,
    quote: false,
    startDate: false,
    endDate: false,
    contractNumber: false,
    poNumber: false,
    invoiceNumber: false,
    contactEmail: false,
    costCentre: false,
    budgetOwnerEmail: false,
  },
  session_timeout: 30,
  password_min_length: 12,
  storage_path: "",
  notification_days: 30,
  manager_email: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_sender: "",
  smtp_use_tls: false,
  smtp_encryption: "starttls",
  notification_send_hour: 7,
  allowed_email_domains: "",
  backup_location: "./backups",
  backup_enabled: false,
  backup_hour: 2,
  backup_keep: 10,
  audit_log_retention_days: 90,
  high_value_threshold: 50000,
  fiscal_year_start_month: 1,
  email_enabled: false,
  oidc_enabled: false,
  oidc_available: false,
  oidc_discovery_url: "",
  oidc_client_id: "",
  oidc_client_secret: "",
  email_template_budget_owner_intro: "",
  email_template_budget_owner_signoff: "",
  email_template_manager_intro: "",
  last_backup_status: null,
  last_backup_at: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sourcingItemPredecessorIds(item) {
  const ids = [];
  const seen = new Set();
  for (const id of [item.renewalForLicenseId, ...(item.cotermPredecessorIds ?? [])]) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function resetSettings() {
  store.userSettings = clone(DEFAULT_USER_SETTINGS);
  store.globalSettings = clone(DEFAULT_GLOBAL_SETTINGS);
}

resetSettings();

export function nextId() {
  return store._nextId++;
}

/**
 * Recompute a license's derived fields after a mutation (create/update/patch/
 * renewal transitions) and bump updatedAt. Mutates and returns the license.
 * Mirrors the enrichment backend routes perform after every write
 * (compute_days_until_expiry / compute_expiration_status - see
 * backend/app/routes/license_renewals.py:35-47, license_maintenance.py:36-48).
 */
export function decorateLicense(license) {
  withDefaultMaintenanceCoverage(license);
  license.daysUntilExpiry = daysUntil(license.endDate);
  const successor = license.renewedToId == null
    ? null
    : store.licenses.find((candidate) => candidate.id === license.renewedToId);
  license.expirationStatus = computeExpirationStatus({
    isRetired: license.isRetired,
    lifecycleStatus: license.lifecycleStatus,
    renewedToId: license.renewedToId,
    successorStartDate: successor?.startDate ?? null,
    startDate: license.startDate,
    endDate: license.endDate,
  });
  license.updatedAt = new Date().toISOString();
  return license;
}

/**
 * Dashboard statistics derived from the live store.
 * Mirrors backend/app/services/license_service.py::compute_stats (verified
 * 2026-07-10, license_service.py:194-280) - counts by expirationStatus,
 * incompleteness, and annual cost (quantity x unitPrice) grouped by currency
 * for active/expiring/perpetual subscription|saas|maintenance licenses that
 * have not been renewed onward.
 */
export function computeStats() {
  const licenses = store.licenses;
  let totalActive = 0;
  let totalExpiring = 0;
  let totalExpired = 0;
  let totalUpcoming = 0;
  let totalPending = 0;
  let totalIncomplete = 0;
  let totalRetired = 0;
  let totalRenewed = 0;
  let totalLegacy = 0;
  const annualCostByCurrency = {};

  for (const lic of licenses) {
    const status = lic.expirationStatus;

    if (status === "retired") totalRetired++;
    else if (status === "legacy") totalLegacy++;
    else if (status === "renewed") totalRenewed++;
    else if (status === "pending_renewal") totalPending++;
    else if (status === "upcoming") totalUpcoming++;
    else if (status === "expired") totalExpired++;
    else if (status === "expiring") {
      totalExpiring++;
      totalActive++;
    } else if (status === "active" || status === "perpetual") totalActive++;

    const completenessPct = computeLicenseCompletenessPct(lic);
    if (
      completenessPct != null &&
      completenessPct < 100 &&
      !["retired", "renewed", "pending_renewal", "legacy"].includes(status)
    ) {
      totalIncomplete++;
    }

    if (["active", "perpetual", "expiring"].includes(status)) {
      if (["subscription", "saas", "maintenance"].includes(lic.licenseType)) {
        const qty = Number(lic.quantity) || 0;
        const price = Number(lic.unitPrice) || 0;
        const cur = lic.currency || "EUR";
        annualCostByCurrency[cur] = (annualCostByCurrency[cur] || 0) + qty * price;
      }
      // Perpetual, OEM, Freeware contribute zero - same as backend.
    }
  }

  return {
    total: licenses.length,
    total_active: totalActive,
    total_expiring: totalExpiring,
    total_expired: totalExpired,
    total_upcoming: totalUpcoming,
    total_pending: totalPending,
    total_incomplete: totalIncomplete,
    total_retired: totalRetired,
    total_renewed: totalRenewed,
    total_legacy: totalLegacy,
    annual_cost_by_currency: annualCostByCurrency,
    excluded_from_totals: 0,
  };
}

/**
 * Distinct, non-empty costCentre values sorted alphabetically.
 * Mirrors backend/app/routes/licenses.py:60-70 (GET /api/licenses/departments).
 */
export function computeDepartments() {
  const set = new Set();
  for (const lic of store.licenses) {
    if (lic.costCentre) set.add(lic.costCentre);
  }
  return [...set].sort();
}

const DOCUMENT_CATEGORIES = {
  invoice: "invoice",
  eula: "eula",
  entitlement: "entitlement",
  purchaseOrder: "purchase_order",
  quote: "quote",
};
const FREEWARE_INAPPLICABLE_FIELDS = new Set([
  "contractNumber",
  "invoice",
  "invoiceNumber",
  "poNumber",
  "purchaseOrder",
  "quote",
]);

function hasDocumentCategory(license, category) {
  const documents = license.documents;
  if (Array.isArray(documents)) {
    return documents.some((doc) => doc.category === category);
  }
  return (documents?.[category]?.length ?? 0) > 0;
}

function hasMandatoryField(license, key) {
  if (DOCUMENT_CATEGORIES[key]) return hasDocumentCategory(license, DOCUMENT_CATEGORIES[key]);
  if (key === "startDate") return hasValue(license.startDate);
  if (key === "endDate") {
    return hasValue(license.endDate) || ["perpetual", "oem", "freeware"].includes(license.licenseType);
  }
  if (key === "contractNumber") return hasValue(license.contractNumber);
  if (key === "poNumber") return hasValue(license.poNumber);
  if (key === "invoiceNumber") return hasValue(license.invoiceNumber);
  if (key === "contactEmail") return hasValue(license.contactEmail);
  if (key === "costCentre") return hasValue(license.costCentre);
  if (key === "budgetOwnerEmail") return hasValue(license.budgetOwnerEmail);
  return false;
}

export function computeLicenseCompletenessPct(license) {
  if (license.isCompletenessExempt) return null;
  const mandatoryFields = store.globalSettings.mandatory_fields ?? {};
  const enabledKeys = Object.entries(mandatoryFields)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .filter((key) => license.licenseType !== "freeware" || !FREEWARE_INAPPLICABLE_FIELDS.has(key));
  if (enabledKeys.length === 0) return 100;

  const met = enabledKeys.filter((key) => hasMandatoryField(license, key)).length;
  return Math.round((met * 100) / enabledKeys.length);
}

export function withComputedCompleteness(license) {
  return {
    ...license,
    completenessPct: computeLicenseCompletenessPct(license),
  };
}

export function computeNotifications() {
  const rank = { critical: 0, warning: 1, info: 2 };
  const threshold = 80;
  return store.licenses
    .filter((license) => !license.isRetired)
    .filter((license) => license.lifecycleStatus !== "legacy")
    .flatMap((license) => {
      const items = [];
      const isRenewed = license.lifecycleStatus === "renewed";
      const isUpcoming = license.startDate ? daysUntil(license.startDate) > 0 : false;
      const days = license.daysUntilExpiry ?? daysUntil(license.endDate);
      const completenessPct = computeLicenseCompletenessPct(license);

      if (license.endDate && !isRenewed && !isUpcoming && days < 0) {
        const overdue = Math.abs(days);
        items.push({
          license_id: license.id,
          software_name: license.softwareDescription,
          publisher: license.publisherName,
          type: "expired",
          detail: `Expired ${overdue} ${overdue === 1 ? "day" : "days"} ago on ${license.endDate}`,
          severity: "critical",
          relevant_date: license.endDate,
        });
      } else if (license.endDate && !isRenewed && !isUpcoming && days >= 0 && days <= (store.globalSettings.notification_days ?? 90)) {
        const severity = days <= 30 ? "critical" : days <= 60 ? "warning" : "info";
        items.push({
          license_id: license.id,
          software_name: license.softwareDescription,
          publisher: license.publisherName,
          type: "expiring",
          detail: `Expires in ${days} ${days === 1 ? "day" : "days"} on ${license.endDate}`,
          severity,
          relevant_date: license.endDate,
        });
      }

      if (!isRenewed && completenessPct != null && completenessPct < threshold) {
        items.push({
          license_id: license.id,
          software_name: license.softwareDescription,
          publisher: license.publisherName,
          type: "incomplete",
          detail: `Record is ${completenessPct}% complete (below ${threshold}%)`,
          severity: "info",
          relevant_date: license.endDate,
        });
      }
      return items;
    })
    .sort((a, b) => {
      const bySeverity = rank[a.severity] - rank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return String(a.relevant_date ?? "9999-12-31").localeCompare(String(b.relevant_date ?? "9999-12-31"));
    });
}

export function computePortfolioReportStats() {
  const stats = computeStats();
  const byLicenseType = {
    subscription: 0,
    perpetual: 0,
    maintenance: 0,
    saas: 0,
    oem: 0,
    freeware: 0,
  };
  for (const license of store.licenses) {
    if (license.isRetired) continue;
    const key = license.licenseType || "unknown";
    byLicenseType[key] = (byLicenseType[key] || 0) + 1;
  }
  return {
    total_active: stats.total_active,
    total_upcoming: stats.total_upcoming,
    total_expiring: stats.total_expiring,
    total_expired: stats.total_expired,
    total_incomplete: stats.total_incomplete,
    annual_cost_by_currency: stats.annual_cost_by_currency,
    excluded_from_totals: stats.excluded_from_totals,
    by_license_type: byLicenseType,
  };
}

const WORKBENCH_VIEWS = new Set([
  "all",
  "needs_action",
  "overdue",
  "due_30",
  "due_60",
  "due_90",
  "in_progress",
  "missing_docs",
  "high_value",
]);
const RECURRING_LICENSE_TYPES = new Set(["subscription", "saas", "maintenance"]);

function parseDecimal(value) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateAnnualValue(license) {
  if (!RECURRING_LICENSE_TYPES.has(license.licenseType)) return 0;
  return parseDecimal(license.quantity) * parseDecimal(license.unitPrice);
}

function hasValue(value) {
  return Boolean(value && String(value).trim());
}

function riskFlag(code, label, severity) {
  return { code, label, severity };
}

function computeRenewalStatus(license, sourcingItem, daysUntilExpiry) {
  if (sourcingItem?.pendingOrderId != null) return "pending_order";
  if (sourcingItem) return "in_sourcing";
  if (license.lifecycleStatus === "pending_renewal") return "pending_renewal";
  if (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
    return "expired_unresolved";
  }
  return "due_soon";
}

function computeRenewalRiskFlags({
  license,
  renewalStatus,
  daysUntilExpiry,
  documentCount,
  estimatedAnnualValue,
  highValueThreshold,
}) {
  const flags = [];
  const completenessPct = computeLicenseCompletenessPct(license);

  if (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
    flags.push(riskFlag("expired", "Expired", "high"));
  } else if (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry <= 30) {
    flags.push(riskFlag("due_30", "Due within 30 days", "high"));
  } else if (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry <= 60) {
    flags.push(riskFlag("due_60", "Due within 60 days", "medium"));
  } else if (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry <= 90) {
    flags.push(riskFlag("due_90", "Due within 90 days", "low"));
  }

  if (!hasValue(license.supplier)) flags.push(riskFlag("no_supplier", "No supplier", "medium"));
  if (!hasValue(license.contractNumber)) flags.push(riskFlag("no_contract", "No contract", "medium"));
  if (!hasValue(license.poNumber)) flags.push(riskFlag("no_po", "No PO", "low"));
  if (documentCount === 0) flags.push(riskFlag("no_documents", "No documents", "medium"));
  if (completenessPct !== null && completenessPct !== undefined && completenessPct < 100) {
    flags.push(riskFlag("incomplete", "Incomplete mandatory fields", "medium"));
  }
  if (estimatedAnnualValue >= highValueThreshold) flags.push(riskFlag("high_value", "High value", "high"));
  if (renewalStatus === "expired_unresolved" || renewalStatus === "due_soon") {
    flags.push(riskFlag(
      "renewal_not_started",
      "Renewal not started",
      renewalStatus === "expired_unresolved" ? "high" : "medium",
    ));
  }
  if (renewalStatus === "pending_order") flags.push(riskFlag("pending_order", "Pending order", "low"));
  return flags;
}

function selectRenewalSourcingItem(licenseId) {
  const items = store.sourcingItems
    .filter((item) => sourcingItemPredecessorIds(item).includes(licenseId))
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  return items.find((item) => item.pendingOrderId != null) ?? items[0] ?? null;
}

function matchesWorkbenchView(row, view, highValueThreshold) {
  if (view === "all") return true;
  if (view === "needs_action") return ["expired_unresolved", "due_soon"].includes(row.renewalStatus);
  if (view === "overdue") return row.renewalStatus === "expired_unresolved";
  if (view === "due_30") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 30;
  if (view === "due_60") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 60;
  if (view === "due_90") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 90;
  if (view === "in_progress") return ["pending_renewal", "in_sourcing", "pending_order"].includes(row.renewalStatus);
  if (view === "missing_docs") return row.documentCount === 0;
  if (view === "high_value") return row.estimatedAnnualValue >= highValueThreshold;
  return true;
}

export function buildRenewalWorkbenchRows({ windowDays = 90, view = "all" } = {}) {
  if (!WORKBENCH_VIEWS.has(view)) throw new Error(`Unsupported workbench view: ${view}`);
  const windowNumber = Number(windowDays);
  if (!Number.isFinite(windowNumber) || windowNumber < 0) {
    throw new Error("window_days must be greater than or equal to 0");
  }

  const highValueThreshold = parseDecimal(store.globalSettings.high_value_threshold ?? 50000);
  return store.licenses
    .filter((license) => !license.isRetired)
    .filter((license) => !["renewed", "legacy"].includes(license.lifecycleStatus))
    .filter((license) => license.endDate || license.lifecycleStatus === "pending_renewal")
    .filter((license) => license.lifecycleStatus === "pending_renewal" || (license.daysUntilExpiry !== null && license.daysUntilExpiry <= windowNumber))
    .map((license) => {
      const sourcingItem = selectRenewalSourcingItem(license.id);
      const pendingOrder = sourcingItem?.pendingOrderId != null
        ? store.pendingOrders.find((order) => order.id === sourcingItem.pendingOrderId)
        : null;
      const daysUntilExpiry = license.daysUntilExpiry ?? daysUntil(license.endDate);
      const documentCount = license.documentCount ?? 0;
      const estimatedAnnualValue = estimateAnnualValue(license);
      const renewalStatus = computeRenewalStatus(license, sourcingItem, daysUntilExpiry);
      const row = {
        licenseId: license.id,
        licenseRef: license.licenseRef,
        publisherName: license.publisherName,
        softwareDescription: license.softwareDescription,
        licenseType: license.licenseType,
        licenseMetric: license.licenseMetric,
        endDate: license.endDate,
        daysUntilExpiry,
        renewalStatus,
        lifecycleStatus: license.lifecycleStatus,
        contractNumber: license.contractNumber ?? "",
        poNumber: license.poNumber ?? "",
        supplier: license.supplier ?? "",
        costCentre: license.costCentre ?? "",
        budgetOwnerEmail: license.budgetOwnerEmail ?? "",
        contactEmail: license.contactEmail ?? "",
        currency: license.currency ?? "EUR",
        quantity: license.quantity ?? "",
        unitPrice: license.unitPrice ?? "",
        estimatedAnnualValue,
        completenessPct: computeLicenseCompletenessPct(license),
        documentCount,
        riskFlags: [],
        sourcingItemId: sourcingItem?.id ?? null,
        pendingOrderId: sourcingItem?.pendingOrderId ?? null,
        pendingOrderNumber: pendingOrder?.poNumber ?? null,
        customFields: license.customFields ?? [],
      };
      row.riskFlags = computeRenewalRiskFlags({
        license,
        renewalStatus,
        daysUntilExpiry,
        documentCount,
        estimatedAnnualValue,
        highValueThreshold,
      });
      return row;
    })
    .filter((row) => matchesWorkbenchView(row, view, highValueThreshold));
}

function sameContractNumber(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

export function buildContractResponse(contract) {
  const documents = store.contractDocuments.filter((doc) => doc.contractId === contract.id);
  const folders = (contract.folders ?? []).map((folder) => ({
    ...folder,
    documentCount: documents.filter((doc) => doc.folderId === folder.id).length,
  }));
  return {
    ...contract,
    licenseCount: store.licenses.filter((license) =>
      sameContractNumber(license.contractNumber, contract.contractNumber)
    ).length,
    documentCount: documents.length,
    folders,
  };
}

export function buildContractLicenseRows(contract) {
  return store.licenses
    .filter((license) => !license.isRetired)
    .filter((license) => sameContractNumber(license.contractNumber, contract.contractNumber))
    .map((license) => ({
      id: license.id,
      publisherName: license.publisherName,
      softwareDescription: license.softwareDescription,
      contractNumber: license.contractNumber,
      startDate: license.startDate,
      endDate: license.endDate,
      lifecycleStatus: license.lifecycleStatus,
      expirationStatus: license.expirationStatus,
    }));
}

export function renameContractNumberOnLicenses(oldContractNumber, newContractNumber) {
  if (!oldContractNumber || sameContractNumber(oldContractNumber, newContractNumber)) return;
  for (const license of store.licenses) {
    if (sameContractNumber(license.contractNumber, oldContractNumber)) {
      license.contractNumber = newContractNumber;
      decorateLicense(license);
    }
  }
}

// Sourcing / pending-order helpers.
// Mirrors backend/app/services/sourcing_service.py and
// backend/app/schemas/pending_order.py's currency formatting
// (verified 2026-07-10). Exported as function DECLARATIONS (not const
// arrows) so they're hoisted and safe to import from fixtures.js despite
// the store.js <-> fixtures.js circular import.

const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£" };

function formatCurrency(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency}\u00a0`;
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sumByCurrency(items) {
  const totals = {};
  for (const item of items) {
    const acquisition = item.estimatedTotalPrice == null ? null : Number(item.estimatedTotalPrice);
    const support = item.maintenanceCoverage === "included"
      && !isBundledIncludedSupport(item.licenseType, item.maintenanceCoverage)
      && item.maintenanceCost != null
      ? Number(item.maintenanceCost)
      : null;
    const validAcquisition = acquisition !== null && !Number.isNaN(acquisition) ? acquisition : 0;
    const validSupport = support !== null && !Number.isNaN(support) ? support : 0;
    if (acquisition === null && support === null) continue;
    totals[item.currency] = (totals[item.currency] || 0) + validAcquisition + validSupport;
  }
  return totals;
}

/** Mirrors backend/app/schemas/pending_order.py:106-121 PendingOrderResponse._compute_total_po_value. */
export function computeTotalPoValue(items) {
  const totals = sumByCurrency(items);
  const currencies = Object.keys(totals);
  if (currencies.length === 0) return null;
  return currencies.map((cur) => formatCurrency(totals[cur], cur)).join(" + ");
}

/** Mirrors backend/app/schemas/sourcing.py:178-195 SourcingRequestResponse._compute_total_estimated_value. */
export function computeTotalEstimatedValue(items) {
  const totals = sumByCurrency(items);
  const currencies = Object.keys(totals);
  if (currencies.length === 0) return null;
  return currencies
    .map((cur) => `${cur} ${totals[cur].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" + ");
}

/** Mirrors backend/app/schemas/pending_order.py:27-58 SourcingItemSummary (nested-in-PO shape). */
export function toSourcingItemSummary(item) {
  return {
    id: item.id,
    sourcingRequestId: item.sourcingRequestId,
    publisherName: item.publisherName,
    softwareDescription: item.softwareDescription,
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    estimatedTotalPrice: item.estimatedTotalPrice,
    currency: item.currency,
    startDate: item.startDate,
    endDate: item.endDate,
    supplier: item.supplier,
    contactEmail: item.contactEmail,
    notes: item.notes,
    status: item.status,
    renewalForLicenseId: item.renewalForLicenseId,
    cotermPredecessorIds: item.cotermPredecessorIds,
    quoteDocuments: [],
    isRenewal: item.renewalForLicenseId != null,
  };
}

/** Recomputes a pending order's items (from the live sourcingItems collection) and its totalPoValue. */
export function rebuildPendingOrderItems(order) {
  order.items = store.sourcingItems
    .filter((i) => i.pendingOrderId === order.id)
    .map(toSourcingItemSummary);
  order.totalPoValue = computeTotalPoValue(order.items);
}

export function withPendingOrderLicenseRefs(order) {
  const activeLicenses = store.licenses.filter((license) => license.pendingOrderId === order.id && !license.isRetired);
  const convertedLicenseIds = activeLicenses.map((license) => license.id);
  const payload = {
    ...order,
    convertedLicenseIds,
    convertedLicenseId: activeLicenses.length === 1 ? activeLicenses[0].id : null,
    convertedLicenseRef: activeLicenses.length === 1 ? activeLicenses[0].licenseRef ?? null : null,
  };
  payload.items = (order.items ?? []).map((item) => {
    const exactMatches = activeLicenses.filter((license) => license.sourceSourcingItemId === item.id);
    const matches = exactMatches.length > 0 ? exactMatches : activeLicenses.filter(
      (license) =>
        license.publisherName === item.publisherName &&
        license.softwareDescription === item.softwareDescription
    );
    return {
      ...item,
      convertedLicenseIds: matches.map((license) => license.id),
      convertedLicenseId: matches.length === 1 ? matches[0].id : null,
      convertedLicenseRef: matches.length === 1 ? matches[0].licenseRef ?? null : null,
    };
  });
  return payload;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findLegacySourceItem(license, order) {
  if (!order) return { item: null, matchType: "none" };
  const items = store.sourcingItems.filter((item) => item.pendingOrderId === order.id);
  const matches = items.filter(
    (item) =>
      normalized(item.publisherName) === normalized(license.publisherName) &&
      normalized(item.softwareDescription) === normalized(license.softwareDescription)
  );
  if (matches.length === 1) return { item: matches[0], matchType: "matched" };
  if (matches.length > 1) return { item: null, matchType: "ambiguous" };
  return { item: null, matchType: "po_only" };
}

function buildTrailDocument(document) {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    category: document.category,
    uploadedAt: document.uploadedAt,
  };
}

function buildTrailSourcingRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    supplier: request.supplier,
    contactEmail: request.contactEmail,
    notes: request.notes,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    quoteDocuments: (request.quoteDocuments ?? []).map(buildTrailDocument),
  };
}

function buildTrailSourcingItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    status: item.status,
    publisherName: item.publisherName,
    softwareDescription: item.softwareDescription,
    licenseType: item.licenseType,
    maintenanceCoverage: item.maintenanceCoverage,
    maintenanceStartDate: item.maintenanceStartDate,
    maintenanceEndDate: item.maintenanceEndDate,
    maintenancePricingBasis: item.maintenancePricingBasis,
    maintenanceQuantity: item.maintenanceQuantity,
    maintenanceUnitPrice: item.maintenanceUnitPrice,
    maintenanceCost: item.maintenanceCost,
    parentSourcingItemId: item.parentSourcingItemId,
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    estimatedTotalPrice: item.estimatedTotalPrice,
    currency: item.currency,
    renewalForLicenseId: item.renewalForLicenseId,
    cotermPredecessorIds: item.cotermPredecessorIds,
  };
}

function buildTrailPendingOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    poNumber: order.poNumber,
    status: order.status,
    supplier: order.supplier,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    documents: (order.documents ?? []).map(buildTrailDocument),
  };
}

export function buildLicenseProcurementTrail(license) {
  const pendingOrder = store.pendingOrders.find((order) => order.id === license.pendingOrderId) ?? null;
  let sourceItem = store.sourcingItems.find((item) => item.id === license.sourceSourcingItemId) ?? null;
  let sourceMatchType = sourceItem ? "exact" : "none";

  if (!sourceItem) {
    const legacyMatch = findLegacySourceItem(license, pendingOrder);
    sourceItem = legacyMatch.item;
    sourceMatchType = legacyMatch.matchType;
  }

  let sourcingRequest = sourceItem
    ? store.sourcingRequests.find((request) => request.id === sourceItem.sourcingRequestId) ?? null
    : null;

  if (!sourcingRequest && pendingOrder) {
    const sourcedItems = store.sourcingItems.filter((item) => item.pendingOrderId === pendingOrder.id && item.sourcingRequestId != null);
    const requestIds = new Set(sourcedItems.map((item) => item.sourcingRequestId));
    if (requestIds.size === 1) {
      sourcingRequest = store.sourcingRequests.find((request) => request.id === sourcedItems[0].sourcingRequestId) ?? null;
    }
  }

  return {
    licenseId: license.id,
    licenseRef: license.licenseRef,
    sourcingRequest: buildTrailSourcingRequest(sourcingRequest),
    sourcingItem: buildTrailSourcingItem(sourceItem),
    pendingOrder: buildTrailPendingOrder(pendingOrder),
    conversion: {
      pendingOrderId: license.pendingOrderId,
      sourceSourcingItemId: sourceItem?.id ?? license.sourceSourcingItemId ?? null,
      sourceMatchType,
      requestDate: license.requestDate,
      purchaseDate: license.purchaseDate,
      renewedFromId: license.renewedFromId,
      predecessorId: license.predecessorId,
      cotermFromIds: license.cotermFromIds,
    },
  };
}

/** Mirrors backend/app/services/sourcing_service.py:112-133 ensure_sourcing_request_for_item. */
export function ensureSourcingRequestForItem(item) {
  if (item.sourcingRequestId != null) {
    const existing = store.sourcingRequests.find((r) => r.id === item.sourcingRequestId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const request = {
    id: nextId(),
    supplier: item.supplier ?? null,
    contactEmail: item.contactEmail ?? null,
    notes: item.notes ?? null,
    status: item.status,
    createdAt: now,
    updatedAt: now,
    createdBy: item.createdBy ?? 1,
  };
  store.sourcingRequests.push(request);
  item.sourcingRequestId = request.id;
  return request;
}

export function cleanProcurementIdentity(value) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

export function procurementIdentitiesMatch(left, right) {
  return normalized(left) === normalized(right);
}

export function synchronizeOpenSourcingRequestIdentity(request, changes = {}) {
  const hasSupplier = Object.prototype.hasOwnProperty.call(changes, "supplier");
  const hasContact = Object.prototype.hasOwnProperty.call(changes, "contactEmail");
  const nextSupplier = hasSupplier ? cleanProcurementIdentity(changes.supplier) : request.supplier;
  const supplierChanged = hasSupplier && !procurementIdentitiesMatch(request.supplier, nextSupplier);

  if (hasSupplier) request.supplier = nextSupplier;
  if (hasContact) request.contactEmail = cleanProcurementIdentity(changes.contactEmail);
  else if (supplierChanged) request.contactEmail = null;

  for (const item of store.sourcingItems.filter(
    (candidate) => candidate.sourcingRequestId === request.id && candidate.status === "sourcing"
  )) {
    item.supplier = request.supplier;
    item.contactEmail = request.contactEmail;
  }
}

/** Mirrors backend/app/services/sourcing_service.py:228-237 backfill_missing_sourcing_requests. */
export function backfillMissingSourcingRequests() {
  for (const item of store.sourcingItems.filter((i) => i.sourcingRequestId == null)) {
    ensureSourcingRequestForItem(item);
  }
}

/** Mirrors backend/app/services/sourcing_service.py:13-23 assert_sourcing_item_editable. */
export function assertSourcingItemEditable(item) {
  if (item.status === "converted" || item.pendingOrderId != null) {
    throw new Error("Cannot modify a converted sourcing item");
  }
  if (item.sourcingRequestId != null) {
    const request = store.sourcingRequests.find((r) => r.id === item.sourcingRequestId);
    if (request && request.status === "converted") {
      throw new Error("Cannot modify an item in a converted sourcing request");
    }
  }
}

/** Mirrors backend/app/schemas/sourcing.py:159-195 SourcingRequestResponse shape. */
export function buildSourcingRequestResponse(request) {
  const items = store.sourcingItems
    .filter((i) => i.sourcingRequestId === request.id)
    .map(withSourcingItemLicenseRefs);
  return {
    ...request,
    items,
    quoteDocuments: [],
    totalEstimatedValue: computeTotalEstimatedValue(items),
  };
}

/** Mirrors backend/app/services/sourcing_service.py - builds a full SourcingItemResponse-shaped item. */
export function buildSourcingItem(payload, overrides = {}) {
  const now = new Date().toISOString();
  const renewalForLicenseId = payload.renewalForLicenseId ?? null;
  const item = {
    id: overrides.id ?? nextId(),
    sourcingRequestId: overrides.sourcingRequestId ?? payload.sourcingRequestId ?? null,
    publisherName: payload.publisherName,
    softwareDescription: payload.softwareDescription,
    licenseType: payload.licenseType ?? null,
    maintenanceCoverage: payload.maintenanceCoverage ?? null,
    maintenanceStartDate: payload.maintenanceStartDate ?? null,
    maintenanceEndDate: payload.maintenanceEndDate ?? null,
    maintenancePricingBasis: payload.maintenancePricingBasis ?? null,
    maintenanceQuantity: payload.maintenanceQuantity ?? null,
    maintenanceUnitPrice: payload.maintenanceUnitPrice ?? null,
    maintenanceCost: payload.maintenanceCost ?? null,
    parentSourcingItemId: payload.parentSourcingItemId ?? null,
    quantity: payload.quantity ?? null,
    estimatedUnitPrice: payload.licenseType === "freeware" ? null : payload.estimatedUnitPrice ?? null,
    estimatedTotalPrice: payload.licenseType === "freeware" ? null : payload.estimatedTotalPrice ?? null,
    currency: payload.currency || "EUR",
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    supplier: payload.supplier ?? null,
    contactEmail: payload.contactEmail ?? null,
    notes: payload.notes ?? null,
    status: overrides.status ?? "sourcing",
    pendingOrderId: overrides.pendingOrderId ?? null,
    convertedLicenseId: null,
    convertedLicenseRef: null,
    convertedLicenseIds: [],
    renewalForLicenseId,
    cotermPredecessorIds: payload.cotermPredecessorIds ?? null,
    isRenewal: renewalForLicenseId != null,
    createdAt: now,
    updatedAt: now,
    createdBy: 1,
  };
  return applyBundledIncludedSupportDefaults(item);
}

/**
 * Side effects after a sourcing item is deleted from the store.
 * Mirrors backend/app/services/sourcing_service.py:26-58 handle_delete_side_effects.
 * Pass parentOrderId: null to skip the orphaned-PO cleanup (mirrors the
 * sourcing-request delete path, which only performs the renewal cleanup
 * see delete_sourcing_request_record, sourcing_service.py:212-225).
 */
function hasOpenRenewalWork(licenseId) {
  return store.sourcingItems.some(
    (item) => item.status !== "cancelled" && sourcingItemPredecessorIds(item).includes(licenseId)
  );
}

export function handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId, renewalLicenseIds = [] }) {
  if (parentOrderId != null) {
    const remaining = store.sourcingItems.filter((i) => i.pendingOrderId === parentOrderId).length;
    if (remaining === 0) {
      store.pendingOrders = store.pendingOrders.filter((p) => p.id !== parentOrderId);
    }
  }
  const predecessorIds = [...new Set([renewalLicenseId, ...renewalLicenseIds].filter((id) => id != null))];
  for (const predecessorId of predecessorIds) {
    const license = store.licenses.find((l) => l.id === predecessorId);
    if (license) {
      if (!hasOpenRenewalWork(predecessorId) && license.lifecycleStatus === "pending_renewal") {
        license.lifecycleStatus = null;
        // Recompute cached expirationStatus (the backend derives it at read
        // time; the demo caches it on the object) and bump updatedAt.
        decorateLicense(license);
      }
    }
  }
}

function buildNewPendingOrder({ poNumber, supplier, notes }) {
  const now = new Date().toISOString();
  return {
    id: nextId(),
    poNumber,
    supplier: supplier ?? null,
    notes: notes ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    createdBy: 1,
    evidenceTransferStatus: null,
    evidenceTransferDetail: null,
    evidenceTransferFailedAt: null,
    items: [],
    documents: [],
    totalPoValue: null,
  };
}

/** Mirrors backend/app/services/sourcing_service.py:257-303 convert_sourcing_item_to_order. */
export function convertSourcingItemToOrder(item, { pendingOrderId, poNumber, supplier, notes }) {
  assertSourcingItemEditable(item);
  const isDirectFreeware = item.licenseType === "freeware"
    && !(item.maintenanceCoverage === "included" && Number(item.maintenanceCost) > 0);
  if (isDirectFreeware) {
    throw new Error("Freeware / Open Source items convert directly to the License Registry");
  }
  ensureSourcingRequestForItem(item);
  const request = store.sourcingRequests.find((candidate) => candidate.id === item.sourcingRequestId);

  let order;
  if (pendingOrderId != null) {
    order = store.pendingOrders.find((p) => p.id === pendingOrderId);
    if (!order) throw new Error("Pending order not found");
    if (!cleanProcurementIdentity(order.supplier)) {
      throw new Error("The selected pending order must have a supplier");
    }
    if (request.supplier && !procurementIdentitiesMatch(request.supplier, order.supplier)) {
      throw new Error("The sourcing request supplier conflicts with the selected pending order supplier");
    }
    synchronizeOpenSourcingRequestIdentity(request, { supplier: order.supplier });
  } else {
    if (!poNumber) throw new Error("po_number is required when pending_order_id is not provided");
    const targetSupplier = cleanProcurementIdentity(supplier) || cleanProcurementIdentity(request.supplier);
    if (!targetSupplier) throw new Error("Supplier is required to create a pending order");
    synchronizeOpenSourcingRequestIdentity(request, { supplier: targetSupplier });
    order = buildNewPendingOrder({ poNumber, supplier: targetSupplier, notes });
    store.pendingOrders.push(order);
  }

  const now = new Date().toISOString();
  item.pendingOrderId = order.id;
  item.status = "converted";
  item.updatedAt = now;

  if (item.sourcingRequestId != null) {
    const request = store.sourcingRequests.find((r) => r.id === item.sourcingRequestId);
    const remaining = store.sourcingItems.filter(
      (i) => i.sourcingRequestId === item.sourcingRequestId && i.status !== "converted"
    ).length;
    if (request && remaining === 0) {
      request.status = "converted";
      request.updatedAt = now;
    }
  }

  rebuildPendingOrderItems(order);
  order.updatedAt = now;
  return order;
}

/** Mirrors backend/app/services/sourcing_service.py:306-341 convert_sourcing_request_to_order. */
export function convertSourcingRequestToOrder(request, { pendingOrderId, poNumber, supplier, notes }) {
  if (request.status === "converted") {
    throw new Error("Sourcing request has already been converted");
  }

  const purchaseItems = store.sourcingItems.filter(
    (item) => item.sourcingRequestId === request.id
      && item.status === "sourcing"
      && (
        item.licenseType !== "freeware"
        || (item.maintenanceCoverage === "included" && Number(item.maintenanceCost) > 0)
      )
  );
  if (purchaseItems.length === 0) {
    throw new Error("No purchase items are available to convert to a pending order");
  }

  let order;
  if (pendingOrderId != null) {
    order = store.pendingOrders.find((p) => p.id === pendingOrderId);
    if (!order) throw new Error("Pending order not found");
    if (!cleanProcurementIdentity(order.supplier)) {
      throw new Error("The selected pending order must have a supplier");
    }
    if (request.supplier && !procurementIdentitiesMatch(request.supplier, order.supplier)) {
      throw new Error("The sourcing request supplier conflicts with the selected pending order supplier");
    }
    synchronizeOpenSourcingRequestIdentity(request, { supplier: order.supplier });
  } else {
    if (!poNumber) throw new Error("po_number is required when pending_order_id is not provided");
    const targetSupplier = cleanProcurementIdentity(supplier) || cleanProcurementIdentity(request.supplier);
    if (!targetSupplier) throw new Error("Supplier is required to create a pending order");
    synchronizeOpenSourcingRequestIdentity(request, { supplier: targetSupplier });
    order = buildNewPendingOrder({
      poNumber,
      supplier: targetSupplier,
      notes: notes != null ? notes : request.notes,
    });
    store.pendingOrders.push(order);
  }

  const now = new Date().toISOString();
  for (const item of purchaseItems) {
    item.pendingOrderId = order.id;
    item.status = "converted";
    item.updatedAt = now;
  }
  request.status = store.sourcingItems.some(
    (item) => item.sourcingRequestId === request.id && item.status === "sourcing"
  ) ? "sourcing" : "converted";
  request.updatedAt = now;

  rebuildPendingOrderItems(order);
  order.updatedAt = now;
  return order;
}

/** Mirrors backend/app/routes/sourcing_items.py:59-145 merge_coterm_sourcing_items. */
export function mergeCotermSourcingItems(ids) {
  if (ids.length < 2) {
    throw new Error("At least two sourcing item IDs are required to merge");
  }

  const items = ids.map((id) => store.sourcingItems.find((i) => i.id === id)).filter(Boolean);
  const foundIds = new Set(items.map((i) => i.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Sourcing item(s) not found: ${[...missing].sort((a, b) => a - b).join(", ")}`);
  }

  const alreadyConverted = items.filter((i) => i.status === "converted").map((i) => i.id);
  if (alreadyConverted.length > 0) {
    throw new Error(`Sourcing item(s) already converted: ${alreadyConverted.join(", ")}`);
  }

  const notRenewals = items.filter((i) => i.renewalForLicenseId == null).map((i) => i.id);
  if (notRenewals.length > 0) {
    throw new Error(`Sourcing item(s) are not renewal items: ${notRenewals.join(", ")}`);
  }

  const predecessors = items.map((i) => store.licenses.find((l) => l.id === i.renewalForLicenseId));
  const missingPredecessors = items
    .filter((_, index) => !predecessors[index])
    .map((i) => i.renewalForLicenseId);
  if (missingPredecessors.length > 0) {
    throw new Error(`Predecessor license(s) not found: ${missingPredecessors.join(", ")}`);
  }

  const ineligible = predecessors
    .filter((l) => ["renewed", "legacy"].includes(l.lifecycleStatus) || l.isRetired)
    .map((l) => l.id);
  if (ineligible.length > 0) {
    throw new Error(`Predecessor license(s) are no longer eligible for renewal: ${[...ineligible].sort((a, b) => a - b).join(", ")}`);
  }

  const productValues = (field) => new Set([
    ...predecessors.map((license) => normalized(license[field])),
    ...items.map((item) => normalized(item[field])),
  ]);
  if (productValues("publisherName").size > 1) {
    throw new Error("Coterm merge requires the same publisher.");
  }
  if (productValues("softwareDescription").size > 1) {
    throw new Error("Coterm merge requires the same software description.");
  }
  if (productValues("licenseMetric").size > 1) {
    throw new Error("Coterm merge requires the same license metric.");
  }
  const presentSkus = new Set(predecessors.map((license) => normalized(license.skuCode)).filter(Boolean));
  if (presentSkus.size > 1) {
    throw new Error("Coterm merge requires matching SKU codes when SKUs are present.");
  }

  const sortedPreds = [...predecessors].sort((a, b) => {
    const aDate = a.startDate ?? "0000-01-01";
    const bDate = b.startDate ?? "0000-01-01";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.id - b.id;
  });
  const primaryPred = sortedPreds[0];
  const primaryItem = items.find((i) => i.renewalForLicenseId === primaryPred.id);

  const totalQuantity = sumCanonicalQuantities(items.map((item) => item.quantity));
  if (totalQuantity == null) {
    throw new Error("Coterm merge requires valid positive quantities.");
  }

  let mergedTotalPrice = null;
  if (primaryItem.estimatedUnitPrice && primaryItem.estimatedUnitPrice.trim() !== "") {
    const unit = Number(primaryItem.estimatedUnitPrice);
    if (!Number.isNaN(unit)) {
      mergedTotalPrice = (unit * Number(totalQuantity)).toFixed(2);
    }
  }

  const commonTarget = (field) => {
    const values = items.map((item) => {
      const request = store.sourcingRequests.find((candidate) => candidate.id === item.sourcingRequestId);
      return cleanProcurementIdentity(request?.[field] ?? item[field]);
    });
    if (values.some((value) => value == null)) return null;
    return values.every((value) => normalized(value) === normalized(values[0])) ? values[0] : null;
  };
  const targetSupplier = commonTarget("supplier");
  const targetContact = targetSupplier ? commonTarget("contactEmail") : null;

  const now = new Date().toISOString();
  const merged = {
    id: nextId(),
    sourcingRequestId: null,
    publisherName: primaryItem.publisherName,
    softwareDescription: primaryItem.softwareDescription,
    quantity: totalQuantity,
    estimatedUnitPrice: primaryItem.estimatedUnitPrice,
    estimatedTotalPrice: mergedTotalPrice,
    currency: primaryItem.currency,
    startDate: null,
    endDate: null,
    supplier: targetSupplier,
    contactEmail: targetContact,
    notes: null,
    status: "sourcing",
    pendingOrderId: null,
    renewalForLicenseId: primaryPred.id,
    cotermPredecessorIds: sortedPreds.map((l) => l.id),
    isRenewal: true,
    createdAt: now,
    updatedAt: now,
    createdBy: 1,
  };

  store.sourcingItems = store.sourcingItems.filter((i) => !foundIds.has(i.id));
  store.sourcingItems.push(merged);
  ensureSourcingRequestForItem(merged);

  return merged;
}

export function initiateRenewalBundleRecord(licenseIds) {
  const orderedIds = [...new Set((licenseIds ?? []).map(Number))];
  if (orderedIds.length < 2) {
    throw new Error("At least two license IDs are required for a renewal bundle");
  }

  const licenses = orderedIds.map((id) => {
    const license = store.licenses.find((item) => item.id === id);
    if (!license) throw new Error(`License(s) not found: ${id}`);
    if (license.lifecycleStatus === "pending_renewal") {
      throw new Error("Renewal already initiated for this license");
    }
    if (license.lifecycleStatus === "renewed") {
      throw new Error("License has already been renewed");
    }
    if (license.renewedToId != null) {
      throw new Error(`License ${license.id} has already been renewed`);
    }
    if (license.endDate == null) {
      throw new Error("Cannot initiate renewal on a perpetual license (no end date)");
    }
    return license;
  });

  const poNumbers = new Set(licenses.map((license) => String(license.poNumber || "").trim()));
  if (poNumbers.size !== 1 || ![...poNumbers][0]) {
    throw new Error("Renewal bundle licenses must share the same PO number");
  }
  if (new Set(licenses.map((license) => license.endDate ?? null)).size !== 1) {
    throw new Error("Renewal bundle licenses must share the same end date");
  }

  const commonValue = (field) => {
    const values = licenses.map((license) => cleanProcurementIdentity(license[field]));
    if (values.some((value) => value == null)) return null;
    return values.every((value) => normalized(value) === normalized(values[0])) ? values[0] : null;
  };
  const targetSupplier = commonValue("supplier");
  const targetContact = targetSupplier ? commonValue("contactEmail") : null;
  const now = new Date().toISOString();
  const request = {
    id: nextId(),
    supplier: targetSupplier,
    contactEmail: targetContact,
    notes: null,
    status: "sourcing",
    createdAt: now,
    updatedAt: now,
    createdBy: 1,
  };
  store.sourcingRequests.push(request);

  const items = [];
  for (const license of licenses) {
    license.lifecycleStatus = "pending_renewal";
    decorateLicense(license);

    const qty = license.quantity || null;
    const unitPrice = license.unitPrice || null;
    const lineTotal = qty && unitPrice ? (Number(qty) * Number(unitPrice)).toFixed(2) : null;
    const sourcingItem = {
      id: nextId(),
      sourcingRequestId: request.id,
      publisherName: license.publisherName,
      softwareDescription: license.softwareDescription,
      quantity: qty,
      estimatedUnitPrice: unitPrice,
      estimatedTotalPrice: lineTotal,
      currency: license.currency,
      startDate: null,
      endDate: null,
      supplier: targetSupplier,
      contactEmail: targetContact,
      notes: null,
      status: "sourcing",
      pendingOrderId: null,
      renewalForLicenseId: license.id,
      cotermPredecessorIds: null,
      isRenewal: true,
      createdAt: now,
      updatedAt: now,
      createdBy: 1,
    };
    store.sourcingItems.push(sourcingItem);
    items.push(sourcingItem);
  }

  return {
    licenses: licenses.map(withComputedCompleteness),
    sourcingRequest: buildSourcingRequestResponse({ ...request, items }),
  };
}

function withSourcingItemLicenseRefs(item) {
  const matches = store.licenses.filter(
    (license) => !license.isRetired && license.sourceSourcingItemId === item.id
  );
  return {
    ...item,
    convertedLicenseIds: matches.map((license) => license.id),
    convertedLicenseId: matches.length === 1 ? matches[0].id : null,
    convertedLicenseRef: matches.length === 1 ? matches[0].licenseRef : null,
  };
}

// Pending-order lifecycle: CRUD, item management, and the decisive
// PO -> license conversion (single and batch).
// Mirrors backend/app/services/pending_order_service.py,
// pending_order_conversion_service.py, conversion_response_service.py,
// renewal_orchestrator.py, lifecycle_rules.py, renewal_workflow.py and
// conversion/{license_converter,pending_order_status}.py
// (all verified 2026-07-10).

/** Mirrors backend/app/services/pending_order_service.py:213-215 ensure_pending_order_editable. */
export function ensurePendingOrderEditable(order, action = "modify") {
  if (order.status === "converted" || order.status === "cancelled") {
    throw new Error(`Cannot ${action} a ${order.status} order`);
  }
}

/** Mirrors backend/app/services/pending_order_service.py:88-97 create_pending_order_record. */
export function createPendingOrderRecord({ poNumber, supplier, notes }) {
  if (!poNumber) throw new Error("po_number is required");
  const order = buildNewPendingOrder({ poNumber, supplier, notes });
  store.pendingOrders.push(order);
  return order;
}

/**
 * Mirrors backend/app/services/pending_order_service.py:117-141 delete_pending_order_record.
 * Backend quirk mirrored deliberately: associated items are reset to status
 * "sourcing" but their pendingOrderId is NOT cleared (the backend leaves
 * pending_order_id in place too, lines 125-129).
 */
export function deletePendingOrderRecord(order) {
  if (order.status !== "pending") {
    throw new Error("Only pending orders with status 'pending' can be deleted");
  }
  const now = new Date().toISOString();
  for (const item of store.sourcingItems.filter((i) => i.pendingOrderId === order.id)) {
    item.status = "sourcing";
    item.updatedAt = now;
  }
  store.pendingOrders = store.pendingOrders.filter((p) => p.id !== order.id);
}

export function cancelPendingOrderRecord(order) {
  ensurePendingOrderEditable(order, "cancel");
  const now = new Date().toISOString();
  order.status = "cancelled";
  order.updatedAt = now;
  const renewalLicenseIds = new Set();
  for (const item of store.sourcingItems.filter((i) => i.pendingOrderId === order.id)) {
    for (const predecessorId of sourcingItemPredecessorIds(item)) renewalLicenseIds.add(predecessorId);
    item.status = "cancelled";
    item.updatedAt = now;
  }
  for (const licenseId of renewalLicenseIds) {
    const license = store.licenses.find((l) => l.id === licenseId);
    if (license && !hasOpenRenewalWork(licenseId) && license.lifecycleStatus === "pending_renewal") {
      license.lifecycleStatus = null;
      decorateLicense(license);
    }
  }
  rebuildPendingOrderItems(order);
  return order;
}

export function convertFreewareSourcingItems(items) {
  if (!items.length) {
    throw new Error("No Freeware / Open Source items are available to convert");
  }

  const now = new Date().toISOString();
  const created = items.map((item) => {
    assertSourcingItemEditable(item);
    if (item.licenseType !== "freeware") {
      throw new Error(`Sourcing item ${item.id} is not Freeware / Open Source`);
    }
    if (item.maintenanceCoverage === "included" && Number(item.maintenanceCost) > 0) {
      throw new Error(`Sourcing item ${item.id} has paid included support and requires the purchase-order workflow`);
    }
    if (item.renewalForLicenseId != null) {
      throw new Error(`Sourcing item ${item.id} is a renewal and must follow the purchase workflow`);
    }

    const request = store.sourcingRequests.find((candidate) => candidate.id === item.sourcingRequestId);
    const id = nextId();
    const license = buildLicense({
      id,
      publisherName: item.publisherName,
      softwareDescription: item.softwareDescription,
      licenseType: "freeware",
      licenseMetric: "per_user",
      quantity: item.quantity ?? "",
      currency: item.currency || "EUR",
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      sourceSourcingItemId: item.id,
      requestDate: item.createdAt,
      purchaseDate: null,
      maintenanceCoverage: item.maintenanceCoverage,
      maintenanceStartDate: item.maintenanceStartDate,
      maintenanceEndDate: item.maintenanceEndDate,
      maintenancePricingBasis: item.maintenancePricingBasis,
      maintenanceQuantity: item.maintenanceQuantity,
      maintenanceUnitPrice: item.maintenanceUnitPrice,
      maintenanceCost: item.maintenanceCost,
      contactEmail: item.contactEmail || request?.contactEmail || "",
      supplier: item.supplier || request?.supplier || "",
      notes: item.notes ?? request?.notes ?? null,
      licenseRef: `LT-2026-${String(id).padStart(4, "0")}`,
      createdAt: now,
      updatedAt: now,
      conversionType: "direct_freeware",
    });
    store.licenses.push(license);
    item.status = "converted";
    item.updatedAt = now;
    return withComputedCompleteness(license);
  });

  const requestIds = new Set(items.map((item) => item.sourcingRequestId).filter((id) => id != null));
  for (const requestId of requestIds) {
    const request = store.sourcingRequests.find((candidate) => candidate.id === requestId);
    const hasOpenItems = store.sourcingItems.some(
      (item) => item.sourcingRequestId === requestId && item.status === "sourcing"
    );
    if (request && !hasOpenItems) {
      request.status = "converted";
      request.updatedAt = now;
    }
  }
  return created;
}

/**
 * Mirrors backend/app/services/pending_order_service.py:158-174 + 225-241
 * (add_pending_order_items_bulk_record + _build_pending_order_item - status,
 * renewal_for_license_id and sourcing_request_id are stripped from the payload;
 * new line items are created with status "converted").
 */
export function addPendingOrderItemsBulk(order, payloads) {
  if (!payloads || payloads.length === 0) {
    throw new Error("At least one item is required");
  }
  ensurePendingOrderEditable(order, "add items to");
  for (const payload of payloads) {
    store.sourcingItems.push(buildSourcingItem(
      { ...payload, renewalForLicenseId: null },
      { status: "converted", pendingOrderId: order.id, sourcingRequestId: null }
    ));
  }
  rebuildPendingOrderItems(order);
  return order;
}

/** Mirrors backend/app/services/conversion/pending_order_status.py:9-15 refresh_order_status. */
export function refreshOrderStatus(order) {
  const items = store.sourcingItems.filter((i) => i.pendingOrderId === order.id);
  const allConverted = items.every((i) => i.status === "converted");
  order.status = allConverted ? "converted" : "invoice_received";
}

/** Mirrors backend/app/services/lifecycle_rules.py:85-95 assert_predecessor_has_no_successor. */
function assertPredecessorHasNoSuccessor(predecessor) {
  if (predecessor.renewedToId != null) {
    throw new Error(`License ${predecessor.id} has already been renewed`);
  }
}

/** Mirrors backend/app/services/lifecycle_rules.py:98-101 mark_predecessor_renewed. */
function markPredecessorRenewed(predecessor, successorId) {
  assertPredecessorHasNoSuccessor(predecessor);
  predecessor.lifecycleStatus = "renewed";
  predecessor.renewedToId = successorId;
  decorateLicense(predecessor);
}

/**
 * Mirrors backend/app/schemas/pending_order.py:124-211 PendingOrderConvertRequest /
 * BatchConvertItem defaults (the subset the demo needs - enum defaults and
 * empty-string date coercion).
 */
function normalizeConvertPayload(payload) {
  const data = { ...payload };
  data.licenseType = data.licenseType || "subscription";
  data.licenseMetric = data.licenseMetric || "per_user";
  data.currency = data.currency || "EUR";
  data.startDate = data.startDate || null;
  data.endDate = data.endDate || null;
  return data;
}

/** Mirrors backend/app/services/renewal_workflow.py:101-142 build_pending_order_item_license_data. */
function buildPendingOrderItemLicenseData(formData, item, oldLicense) {
  const data = { ...formData };

  data.publisherName = item.publisherName;
  data.softwareDescription = item.softwareDescription;
  data.requestDate = item.createdAt;

  if (item.quantity != null) data.quantity = item.quantity;
  if (item.estimatedUnitPrice != null) data.unitPrice = item.estimatedUnitPrice;
  if (item.estimatedTotalPrice != null) data.totalPoPrice = item.estimatedTotalPrice;
  if (item.maintenanceCoverage != null) data.maintenanceCoverage = item.maintenanceCoverage;
  if (item.maintenanceStartDate != null) data.maintenanceStartDate = item.maintenanceStartDate;
  if (item.maintenanceEndDate != null) data.maintenanceEndDate = item.maintenanceEndDate;
  if (item.maintenancePricingBasis != null) data.maintenancePricingBasis = item.maintenancePricingBasis;
  if (item.maintenanceQuantity != null) data.maintenanceQuantity = item.maintenanceQuantity;
  if (item.maintenanceUnitPrice != null) data.maintenanceUnitPrice = item.maintenanceUnitPrice;
  if (item.maintenanceCost != null) data.maintenanceCost = item.maintenanceCost;
  if (item.currency) data.currency = item.currency;
  if (!data.supplier && item.supplier) data.supplier = item.supplier;
  if (item.contactEmail) data.contactEmail = item.contactEmail;

  if (oldLicense != null) {
    data.notes = null;
    data.licenseType = oldLicense.licenseType;
    data.licenseMetric = oldLicense.licenseMetric;
    if (oldLicense.licenseType === "maintenance") data.parentLicenseId = oldLicense.parentLicenseId;
    if (oldLicense.skuCode) data.skuCode = oldLicense.skuCode;
    if (oldLicense.costCentre) data.costCentre = oldLicense.costCentre;
    if (oldLicense.budgetOwnerEmail) data.budgetOwnerEmail = oldLicense.budgetOwnerEmail;
  }

  return data;
}

/**
 * Create a converted license in the store as a full LicenseResponse shape.
 * licenseRef semantics mirror the backend: renewal successors inherit the
 * predecessor's ref via licenseRefOverride (renewal_orchestrator.py:273);
 * everything else gets a fresh generated ref (license_converter.py:53),
 * formatted like the license-create route (see the POST /api/licenses handler).
 */
function buildConvertedLicense(itemData, { renewedFromId = null, predecessorId = null, cotermFromIds = null, licenseRefOverride = null } = {}) {
  const now = new Date().toISOString();
  const id = nextId();
  const license = buildLicense({
    ...itemData,
    id,
    renewedFromId,
    predecessorId,
    cotermFromIds,
    licenseRef: licenseRefOverride ?? `LT-2026-${String(id).padStart(4, "0")}`,
    createdAt: now,
    updatedAt: now,
  });
  store.licenses.push(license);
  return license;
}

/**
 * Mirrors backend/app/services/conversion/license_converter.py:10-54
 * create_purchase_license. The maintenance-parent linking path
 * (create_maintenance_purchase / parentSourcingItemId) is simplified: the
 * demo passes parentLicenseId through without parent mirror-field syncing.
 */
function createPurchaseLicense(itemData) {
  const data = { ...itemData };
  delete data.parentSourcingItemId;
  if (data.licenseType === "perpetual") data.endDate = null;
  if (data.licenseType === "freeware") {
    data.unitPrice = "";
    data.totalPoPrice = "";
  }
  if (data.licenseType !== "maintenance" && data.parentLicenseId != null) {
    throw new Error("parentLicenseId is only valid for maintenance licenses");
  }
  data.maintenanceCoverage = data.maintenanceCoverage || defaultMaintenanceCoverage(data.licenseType);
  applyBundledIncludedSupportDefaults(data);
  return buildConvertedLicense(data);
}

/**
 * Mirrors backend/app/services/renewal_orchestrator.py:134-290
 * create_renewal_successor_from_sourcing_item (standard and coterm renewals).
 * Returns { successor, predecessorIds }.
 */
export function createRenewalSuccessorFromSourcingItem(sourcingItem, licenseData) {
  const oldLic = store.licenses.find((l) => l.id === sourcingItem.renewalForLicenseId);
  if (!oldLic) {
    throw new Error(`License ${sourcingItem.renewalForLicenseId} not found for renewal`);
  }

  const data = { ...licenseData };
  if (oldLic.licenseType === "maintenance") {
    data.licenseType = oldLic.licenseType;
    data.licenseMetric = oldLic.licenseMetric;
    data.parentLicenseId = oldLic.parentLicenseId;
  }
  const successorType = data.licenseType ?? oldLic.licenseType;
  data.maintenanceCoverage = data.maintenanceCoverage || defaultMaintenanceCoverage(successorType);
  applyBundledIncludedSupportDefaults(data);
  delete data.parentSourcingItemId;

  if (sourcingItem.cotermPredecessorIds && sourcingItem.cotermPredecessorIds.length > 0) {
    const predIds = [...sourcingItem.cotermPredecessorIds];
    const preds = predIds
      .map((pid) => store.licenses.find((l) => l.id === pid))
      .filter(Boolean);
    for (const pred of preds) assertPredecessorHasNoSuccessor(pred);

    const primaryPred = preds.find((p) => p.id === predIds[0]);
    const successor = buildConvertedLicense(data, {
      renewedFromId: predIds[0],
      predecessorId: predIds[0],
      cotermFromIds: predIds,
      licenseRefOverride: (primaryPred && primaryPred.licenseRef) || null,
    });

    const markedPredecessorIds = [];
    for (const pred of preds) {
      markPredecessorRenewed(pred, successor.id);
      markedPredecessorIds.push(pred.id);
    }
    return { successor, predecessorIds: markedPredecessorIds };
  }

  assertPredecessorHasNoSuccessor(oldLic);
  const successor = buildConvertedLicense(data, {
    renewedFromId: oldLic.id,
    predecessorId: oldLic.id,
    licenseRefOverride: oldLic.licenseRef || null,
  });
  markPredecessorRenewed(oldLic, successor.id);
  return { successor, predecessorIds: [oldLic.id] };
}

/**
 * Mirrors backend/app/services/conversion_response_service.py:17-48
 * build_conversion_response: one LicenseResponse per DISTINCT license id
 * (the backend's `WHERE id IN (...)` dedupes), conversionType from the
 * new-entries map, predecessors default to "renewed_predecessor".
 * Returns copies so conversionType stays a response-only field, exactly
 * like the backend (it is never persisted on the license row).
 */
function buildConversionResponse(newLicenseEntries, predecessorIds) {
  const typeById = new Map();
  for (const [lic, type] of newLicenseEntries) typeById.set(lic.id, type);
  const ids = [...new Set([...newLicenseEntries.map(([lic]) => lic.id), ...predecessorIds])];
  return ids
    .map((id) => store.licenses.find((l) => l.id === id))
    .filter(Boolean)
    .map((lic) => ({
      ...withComputedCompleteness(lic),
      conversionType: typeById.get(lic.id) ?? "renewed_predecessor",
    }));
}

/**
 * THE decisive transition: convert a pending order into live license(s).
 * Mirrors backend/app/services/pending_order_conversion_service.py:110-267
 * convert_pending_order_to_licenses (minus file/evidence transfer - documents
 * are stubbed in the demo). Returns list[LicenseResponse]: new licenses plus
 * renewed predecessors.
 */
export function convertPendingOrderToLicenses(order, payload) {
  if (order.status === "converted") {
    throw new Error("Pending order has already been converted");
  }
  if (order.status === "cancelled") {
    throw new Error("Pending order has been cancelled");
  }

  const orderSupplier = cleanProcurementIdentity(order.supplier);
  const submittedSupplier = cleanProcurementIdentity(payload?.supplier);
  if (orderSupplier && submittedSupplier && !procurementIdentitiesMatch(orderSupplier, submittedSupplier)) {
    throw new Error("License supplier must match the pending order supplier");
  }
  const formData = {
    ...normalizeConvertPayload(payload),
    pendingOrderId: order.id,
    purchaseDate: order.createdAt,
    ...(orderSupplier ? { supplier: orderSupplier } : {}),
  };

  const items = store.sourcingItems.filter((i) => i.pendingOrderId === order.id);
  const newLicenseEntries = []; // [license, conversionType] pairs
  const predecessorIds = [];

  if (items.length === 0) {
    newLicenseEntries.push([createPurchaseLicense(formData), "new_purchase"]);
  } else {
    for (const item of items) {
      if (item.renewalForLicenseId != null) {
        const oldLic = store.licenses.find((l) => l.id === item.renewalForLicenseId);
        if (!oldLic) {
          throw new Error(`License ${item.renewalForLicenseId} not found for renewal`);
        }
        const itemData = buildPendingOrderItemLicenseData(formData, item, oldLic);
        itemData.sourceSourcingItemId = item.id;
        const { successor, predecessorIds: marked } = createRenewalSuccessorFromSourcingItem(item, itemData);
        newLicenseEntries.push([successor, "renewed"]);
        predecessorIds.push(...marked);
      } else {
        const itemData = buildPendingOrderItemLicenseData(formData, item, null);
        itemData.sourceSourcingItemId = item.id;
        newLicenseEntries.push([createPurchaseLicense(itemData), "new_purchase"]);
      }
    }
  }

  const now = new Date().toISOString();
  for (const item of items) {
    item.status = "converted";
    item.updatedAt = now;
  }
  refreshOrderStatus(order);
  rebuildPendingOrderItems(order);
  order.updatedAt = now;

  return buildConversionResponse(newLicenseEntries, predecessorIds);
}

/**
 * Mirrors backend/app/services/pending_order_conversion_service.py:270-440
 * batch_convert_pending_order_to_licenses: convert specific sourcing items in
 * a PO into licenses (JSON array of BatchConvertItem). Maintenance-typed new
 * purchases are deferred to a second pass, like the backend, so any parent
 * created in the same batch exists first.
 */
export function batchConvertPendingOrderToLicenses(order, payload) {
  if (order.status === "converted") {
    throw new Error("Pending order has already been converted");
  }
  if (order.status === "cancelled") {
    throw new Error("Pending order has been cancelled");
  }
  if (!payload || payload.length === 0) {
    throw new Error("Payload must contain at least one item");
  }
  const orderSupplier = cleanProcurementIdentity(order.supplier);
  for (const item of payload) {
    const submittedSupplier = cleanProcurementIdentity(item.supplier);
    if (orderSupplier && submittedSupplier && !procurementIdentitiesMatch(orderSupplier, submittedSupplier)) {
      throw new Error(`Item ${item.sourcingItemId}: License supplier must match the pending order supplier`);
    }
  }

  const orderItems = store.sourcingItems.filter((i) => i.pendingOrderId === order.id);
  const itemById = new Map(orderItems.map((i) => [i.id, i]));

  const newLicenseEntries = [];
  const predecessorIds = [];
  const pendingMaintenanceItems = []; // [sourcingItem, itemData] pairs
  const now = new Date().toISOString();

  for (const batchItem of payload) {
    const sourcingItem = itemById.get(batchItem.sourcingItemId);
    if (!sourcingItem) {
      throw new Error(`Item ${batchItem.sourcingItemId}: not found in pending order ${order.id}`);
    }

    // Mirror model_dump(exclude={"sourcing_item_id"}): the id routes the item, it is not license data.
    const rest = { ...batchItem };
    delete rest.sourcingItemId;
    const itemData = {
      ...normalizeConvertPayload(rest),
      pendingOrderId: order.id,
      sourceSourcingItemId: sourcingItem.id,
      requestDate: sourcingItem.createdAt,
      purchaseDate: order.createdAt,
      ...(orderSupplier ? { supplier: orderSupplier } : {}),
    };

    if (sourcingItem.renewalForLicenseId != null) {
      delete itemData.parentSourcingItemId;
      const oldLic = store.licenses.find((l) => l.id === sourcingItem.renewalForLicenseId);
      if (!oldLic) {
        throw new Error(`Item ${batchItem.sourcingItemId}: license ${sourcingItem.renewalForLicenseId} not found for renewal`);
      }
      const { successor, predecessorIds: marked } = createRenewalSuccessorFromSourcingItem(sourcingItem, itemData);
      newLicenseEntries.push([successor, "renewed"]);
      predecessorIds.push(...marked);
    } else {
      if (itemData.licenseType === "maintenance") {
        pendingMaintenanceItems.push([sourcingItem, itemData]);
        continue;
      }
      newLicenseEntries.push([createPurchaseLicense(itemData), "new_purchase"]);
    }
    sourcingItem.status = "converted";
    sourcingItem.updatedAt = now;
  }

  for (const [sourcingItem, itemData] of pendingMaintenanceItems) {
    newLicenseEntries.push([createPurchaseLicense(itemData), "new_purchase"]);
    sourcingItem.status = "converted";
    sourcingItem.updatedAt = now;
  }

  refreshOrderStatus(order);
  rebuildPendingOrderItems(order);
  order.updatedAt = now;

  return buildConversionResponse(newLicenseEntries, predecessorIds);
}

export function resetStore() {
  store.licenses = [];
  store.contracts = [];
  store.contractDocuments = [];
  store.sourcingItems = [];
  store.sourcingRequests = [];
  store.pendingOrders = [];
  store.organizations = [];
  store.costCentres = [];
  store.userDepartments = {};
  resetSettings();
  store.seeded = false;
  store._nextId = 1000;
}

export function seedStore() {
  const seed = buildSeedData();
  store.licenses = seed.licenses;
  store.contracts = seed.contracts;
  store.contractDocuments = seed.contractDocuments;
  store.sourcingItems = seed.sourcingItems;
  store.sourcingRequests = seed.sourcingRequests;
  store.pendingOrders = seed.pendingOrders;
  const organizations = new Map();
  const organizationValues = [
    ...store.licenses.flatMap((license) => [[license.publisherName, "publisher"], [license.supplier, "supplier"]]),
    ...store.contracts.map((contract) => [contract.publisherName, "publisher"]),
    ...store.sourcingRequests.map((request) => [request.supplier, "supplier"]),
    ...store.sourcingItems.flatMap((item) => [[item.publisherName, "publisher"], [item.supplier, "supplier"]]),
    ...store.pendingOrders.map((order) => [order.supplier, "supplier"]),
  ];
  for (const [name, role] of organizationValues) {
    if (!name) continue;
    const key = name.trim().toLowerCase();
    const record = organizations.get(key) || { id: 500 + organizations.size, name, normalizedName: key, isPublisher: false, isSupplier: false, isActive: true, aliases: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (role === "publisher") record.isPublisher = true;
    if (role === "supplier") record.isSupplier = true;
    organizations.set(key, record);
  }
  store.organizations = [...organizations.values()];
  const costCentres = new Map();
  for (const license of store.licenses) {
    if (!license.costCentre) continue;
    const key = license.costCentre.trim().toLowerCase();
    costCentres.set(key, costCentres.get(key) || { id: 700 + costCentres.size, name: license.costCentre, normalizedName: key, isActive: true, aliases: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  store.costCentres = [...costCentres.values()];
  store.userDepartments = { 2: store.costCentres[0] ? [store.costCentres[0].name] : [] };
  resetSettings();
  store.seeded = true;
}

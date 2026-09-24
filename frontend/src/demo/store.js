import {
  buildLicense, buildSeedData, computeExpirationStatus, computeSupportDaysRemaining, computeSupportStatus,
} from "./fixtures.js";
import {
  applyIncludedSupportDefaults,
  defaultMaintenanceCoverage,
  isBundledIncludedSupport,
  withDefaultMaintenanceCoverage,
} from "./supportDefaults.js";
import { addDaysIso, daysUntil, inclusiveTermDays, termEnd } from "./time.js";
import { sumCanonicalQuantities } from "../utils/quantity.js";
import {
  isNonExpiringLicenseType,
  isRenewableLicense,
  isRenewalOptInLicenseType,
  typeDescriptionMissing,
} from "../utils/licenseTypeRules.js";
import { procurementIdentityKey } from "../utils/procurementIdentity.js";

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

// Mirrors a fresh install's GlobalSettings row (backend/app/models/settings.py,
// re-verified 2026-09-24 against 1.1.24): new installs require PO number,
// invoice number and budget owner; the high-value threshold is per currency.
const DEFAULT_GLOBAL_SETTINGS = {
  mandatory_fields: {
    invoice: false,
    eula: false,
    entitlement: false,
    purchaseOrder: false,
    quote: false,
    startDate: false,
    endDate: false,
    noticeDate: false,
    contractNumber: false,
    poNumber: true,
    invoiceNumber: true,
    contactEmail: false,
    costCentre: false,
    budgetOwnerEmail: true,
  },
  session_timeout: 30,
  password_min_length: 12,
  storage_path: "",
  notification_days: 30,
  renewal_action_days: null,
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
  public_base_url: "",
  backup_location: "./backups",
  backup_enabled: false,
  backup_hour: 2,
  backup_keep: 10,
  audit_log_retention_days: 90,
  high_value_threshold: 50000,
  high_value_thresholds: { EUR: "50000" },
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
    licenseType: license.licenseType,
    renewedToId: license.renewedToId,
    successorStartDate: successor?.startDate ?? null,
    startDate: license.startDate,
    endDate: license.endDate,
  });
  license.supportDaysRemaining = computeSupportDaysRemaining(license);
  license.supportStatus = computeSupportStatus(license);
  license.updatedAt = new Date().toISOString();
  return license;
}

// ---------------------------------------------------------------------------
// License type rules (1.1.24). Mirrors backend/app/services/license_service.py
// normalise_type_opt_in_fields / is_recurring_license / annualize_term_cost and
// license_write_service.py normalise_license_type_fields + _sync_invoice_numbers
// (re-verified 2026-09-24 against 1.1.24).
// ---------------------------------------------------------------------------

export const TYPE_DESCRIPTION_REQUIRED_DETAIL = "Add a type description for an Other license";

/** Keep isRenewable only on Service/Other, typeDescription only on Other, the supported license only on maintenance lines. */
export function normaliseTypeOptInFields(data) {
  if ("isRenewable" in data && !isRenewalOptInLicenseType(data.licenseType)) data.isRenewable = null;
  if ("typeDescription" in data) {
    const description = String(data.typeDescription ?? "").trim();
    data.typeDescription = data.licenseType === "other" && description ? description : null;
  }
  if ("maintenanceParentLicenseId" in data && data.licenseType !== "maintenance") {
    data.maintenanceParentLicenseId = null;
  }
  return data;
}

/** Persisted invariants fixed by the license type: no end date for non-expiring types, no prices for freeware. */
export function normaliseLicenseTypeFields(data) {
  if (data.licenseType === "freeware") {
    data.unitPrice = "";
    data.totalPoPrice = "";
  }
  if (isNonExpiringLicenseType(data.licenseType)) data.endDate = null;
  return normaliseTypeOptInFields(data);
}

export function validateTypeDescription(licenseType, typeDescription) {
  if (typeDescriptionMissing(licenseType, typeDescription)) throw new Error(TYPE_DESCRIPTION_REQUIRED_DETAIL);
}

/** Keep the legacy primary invoiceNumber mirrored from the invoiceNumbers list. */
export function syncInvoiceNumbers(data) {
  if ("invoiceNumbers" in data) {
    const numbers = (data.invoiceNumbers ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
    data.invoiceNumbers = numbers;
    if (numbers.length) {
      data.invoiceNumber = numbers[0];
    } else if (data.invoiceNumber) {
      data.invoiceNumbers = [data.invoiceNumber];
    } else {
      data.invoiceNumber = "";
    }
    return data;
  }
  if ("invoiceNumber" in data) {
    const primary = data.invoiceNumber || "";
    data.invoiceNumber = primary;
    data.invoiceNumbers = primary ? [primary] : [];
  }
  return data;
}

const RECURRING_LICENSE_TYPES = new Set(["subscription", "saas", "maintenance"]);

/** Whether the license line itself is a recurring (annual-cost) charge; renewable Service/Other count. */
export function isRecurringLicense(license) {
  if (RECURRING_LICENSE_TYPES.has(license.licenseType)) return true;
  return isRenewalOptInLicenseType(license.licenseType) && isRenewableLicense(license);
}

// A one-year term counts 366 inclusive days when it spans 29 February or ends
// on the anniversary date, so only genuinely longer terms are scaled to 365 days.
const MAX_ONE_YEAR_TERM_DAYS = 366;

export function annualizeTermCost(amount, startDate, endDate) {
  const termDays = inclusiveTermDays(startDate, endDate);
  if (termDays === null || termDays <= MAX_ONE_YEAR_TERM_DAYS) return amount;
  return (amount * 365) / termDays;
}

function lineTotal(license) {
  return parseDecimal(license.quantity) * parseDecimal(license.unitPrice);
}

/**
 * Mirrors backend/app/services/po_total_override_service.py
 * count_po_overrides_not_in_annual: annual-cost views are line based, so a
 * manual PO total that differs from its group's line sum is informational there.
 */
export function countPoOverridesNotInAnnual(included, allLicenses) {
  const keyOf = (license) => {
    const identity = procurementIdentityKey(license);
    return identity ? identity.join("|") : null;
  };
  const lineSums = new Map();
  for (const license of allLicenses) {
    const key = keyOf(license);
    if (key !== null) lineSums.set(key, (lineSums.get(key) ?? 0) + lineTotal(license));
  }
  const differing = new Set();
  for (const license of included) {
    const key = keyOf(license);
    if (!license.poTotalOverride || key === null) continue;
    const override = Number(license.poTotalOverride);
    if (!Number.isFinite(override)) continue;
    if (Math.abs(override - (lineSums.get(key) ?? 0)) > 0.000001) differing.add(key);
  }
  return differing.size;
}

/**
 * Dashboard statistics derived from the live store.
 * Mirrors backend/app/services/license_service.py::compute_stats (re-verified
 * 2026-09-24 against 1.1.24) - counts by expirationStatus, incompleteness, and
 * annualized line cost (quantity x unitPrice; terms longer than one year scaled
 * to 365 days) grouped by currency for active/expiring/perpetual recurring
 * licenses (subscription, SaaS, maintenance, renewable Service/Other).
 * po_overrides_not_in_annual counts manual PO totals that line-based annual
 * cost does not reflect.
 *
 * pending_renewal is a workflow state on lifecycleStatus, not an expiration
 * status, so total_pending is counted from lifecycleStatus independently of the
 * expiration bucket, and pending records still count toward incompleteness.
 * total_retirement_scheduled counts licenses flagged to auto-retire at term end.
 */
export function computeStats() {
  const licenses = store.licenses;
  let totalActive = 0;
  let totalExpiring = 0;
  let totalExpired = 0;
  let totalUpcoming = 0;
  let totalPending = 0;
  let totalRetirementScheduled = 0;
  let totalIncomplete = 0;
  let totalRetired = 0;
  let totalRenewed = 0;
  let totalLegacy = 0;
  const annualCostByCurrency = {};
  const annualCostLicenses = [];

  for (const lic of licenses) {
    const status = lic.expirationStatus;

    if (status === "retired") totalRetired++;
    else if (status === "legacy") totalLegacy++;
    else if (status === "renewed") totalRenewed++;
    else if (status === "upcoming") totalUpcoming++;
    else if (status === "expired") totalExpired++;
    else if (status === "expiring") {
      totalExpiring++;
      totalActive++;
    } else if (status === "active" || status === "perpetual") totalActive++;

    if (lic.lifecycleStatus === "pending_renewal") totalPending++;
    if (lic.retirementScheduled) totalRetirementScheduled++;

    const completenessPct = computeLicenseCompletenessPct(lic);
    if (
      completenessPct != null &&
      completenessPct < 100 &&
      !["retired", "renewed", "legacy"].includes(status)
    ) {
      totalIncomplete++;
    }

    if (["active", "perpetual", "expiring"].includes(status)) {
      if (isRecurringLicense(lic)) {
        const annualCost = annualizeTermCost(lineTotal(lic), lic.startDate, lic.endDate);
        const cur = lic.currency || "EUR";
        annualCostByCurrency[cur] = (annualCostByCurrency[cur] || 0) + annualCost;
        annualCostLicenses.push(lic);
      }
      // Perpetual, OEM, Freeware and one-off Service/Other contribute zero - same as backend.
    }
  }

  return {
    total: licenses.length,
    total_active: totalActive,
    total_expiring: totalExpiring,
    total_expired: totalExpired,
    total_upcoming: totalUpcoming,
    total_pending: totalPending,
    total_retirement_scheduled: totalRetirementScheduled,
    total_incomplete: totalIncomplete,
    total_retired: totalRetired,
    total_renewed: totalRenewed,
    total_legacy: totalLegacy,
    annual_cost_by_currency: annualCostByCurrency,
    excluded_from_totals: 0,
    po_overrides_not_in_annual: countPoOverridesNotInAnnual(annualCostLicenses, licenses),
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
    // Non-expiring types and one-off Service/Other intentionally allow no end date.
    return hasValue(license.endDate) || isNonExpiringLicenseType(license.licenseType) || !isRenewableLicense(license);
  }
  if (key === "noticeDate") return hasValue(license.noticeDate);
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

const dayWord = (days) => (Math.abs(days) === 1 ? "day" : "days");
const expirySeverity = (days) => (days <= 30 ? "critical" : days <= 60 ? "warning" : "info");
const noticeSeverity = (days) => (days <= 7 ? "critical" : days <= 30 ? "warning" : "info");

/**
 * Mirrors backend/app/services/notification_classification.py
 * classify_license_alerts (re-verified 2026-09-24 against 1.1.24): one-off
 * Service/Other never raise expiry alerts, included support on
 * perpetual/OEM/freeware raises support_expiring/support_expired, unhandled
 * notice deadlines raise notice_due, and a record below 100% is incomplete.
 */
export function computeNotifications() {
  const rank = { critical: 0, warning: 1, info: 2 };
  const threshold = 100;
  const expiryWindow = store.globalSettings.notification_days ?? 90;
  const noticeWindow = store.globalSettings.notice_notification_days ?? 30;
  return store.licenses
    .filter((license) => !license.isRetired && !license.retirementScheduled)
    .filter((license) => !["legacy", "renewed"].includes(license.lifecycleStatus) && license.renewedToId == null)
    .flatMap((license) => {
      const items = [];
      const alert = (type, detail, severity, relevantDate) => items.push({
        license_id: license.id,
        software_name: license.softwareDescription,
        publisher: license.publisherName,
        type,
        detail,
        severity,
        relevant_date: relevantDate,
      });
      const isUpcoming = license.startDate ? daysUntil(license.startDate) > 0 : false;
      const days = daysUntil(license.endDate);
      const inProgress = license.lifecycleStatus === "pending_renewal" ? "; renewal is in progress" : "";

      if (!isUpcoming && isRenewableLicense(license) && license.endDate) {
        if (days < 0) {
          alert("expired", `Expired ${-days} ${dayWord(days)} ago on ${license.endDate}${inProgress}`, "critical", license.endDate);
        } else if (days <= expiryWindow) {
          alert("expiring", `Expires in ${days} ${dayWord(days)} on ${license.endDate}${inProgress}`, expirySeverity(days), license.endDate);
        }
      }

      const supportDays = computeSupportDaysRemaining(license);
      if (!isUpcoming && supportDays !== null) {
        const supportEnd = license.maintenanceEndDate;
        if (supportDays < 0) {
          alert("support_expired", `Support expired ${-supportDays} ${dayWord(supportDays)} ago on ${supportEnd}`, "critical", supportEnd);
        } else if (supportDays <= expiryWindow) {
          alert("support_expiring", `Support ends in ${supportDays} ${dayWord(supportDays)} on ${supportEnd}`, expirySeverity(supportDays), supportEnd);
        }
      }

      if (license.noticeDate && !license.noticeHandledAt && !isUpcoming) {
        const noticeDays = daysUntil(license.noticeDate);
        if (noticeDays < 0) {
          alert("notice_due", `Notice deadline passed ${-noticeDays} ${dayWord(noticeDays)} ago on ${license.noticeDate}`, "critical", license.noticeDate);
        } else if (noticeDays <= noticeWindow) {
          alert("notice_due", `Notice deadline in ${noticeDays} ${dayWord(noticeDays)} on ${license.noticeDate}`, noticeSeverity(noticeDays), license.noticeDate);
        }
      }

      const completenessPct = computeLicenseCompletenessPct(license);
      if (completenessPct != null && completenessPct < threshold) {
        alert("incomplete", `Record is ${completenessPct}% complete (below ${threshold}%)`, "info", license.endDate);
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
    service: 0,
    other: 0,
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
    po_overrides_not_in_annual: stats.po_overrides_not_in_annual,
    by_license_type: byLicenseType,
  };
}

// Renewal Workbench. Mirrors backend/app/services/renewal_service.py and
// renewal_workbench_model.py (re-verified 2026-09-24 against 1.1.24):
// candidates exclude retired, retirement-scheduled and one-off Service/Other
// records; an unhandled notice deadline inside the window makes a record a
// candidate and is flagged; included support on perpetual/OEM/freeware adds
// "support_renewal" rows; rows sort by the earlier of notice and end date; the
// high-value flag uses the row currency's threshold only (no FX conversion).

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
  "notice_due",
]);
const INCLUDED_SUPPORT_PARENT_TYPES = new Set(["perpetual", "oem", "freeware"]);

function parseDecimal(value) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateAnnualValue(license) {
  if (!isRecurringLicense(license)) return 0;
  return annualizeTermCost(lineTotal(license), license.startDate, license.endDate);
}

function hasValue(value) {
  return Boolean(value && String(value).trim());
}

function riskFlag(code, label, severity) {
  return { code, label, severity };
}

/** Per-currency high-value thresholds; a currency without one is never flagged. */
function highValueThresholds() {
  const thresholds = {};
  for (const [currency, amount] of Object.entries(store.globalSettings.high_value_thresholds ?? {})) {
    if (amount === null || amount === undefined || String(amount).trim() === "") continue;
    thresholds[String(currency).trim().toUpperCase()] = parseDecimal(amount);
  }
  return thresholds;
}

function daysUntilNotice(license) {
  if (!license.noticeDate || license.noticeHandledAt) return null;
  return daysUntil(license.noticeDate);
}

function effectiveDeadlineDays(row) {
  const candidates = [row.daysUntilExpiry, row.daysUntilNotice].filter((days) => days !== null && days !== undefined);
  return candidates.length ? Math.min(...candidates) : null;
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
  daysUntilNotice: noticeDays = null,
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

  if (noticeDays !== null && noticeDays < 0) {
    flags.push(riskFlag("notice_passed", "Notice deadline passed", "high"));
  } else if (noticeDays !== null && noticeDays <= 90) {
    const severity = noticeDays <= 30 ? "high" : noticeDays <= 60 ? "medium" : "low";
    flags.push(riskFlag("notice_due", `Notice deadline in ${noticeDays} ${noticeDays === 1 ? "day" : "days"}`, severity));
  }

  if (!hasValue(license.supplier)) flags.push(riskFlag("no_supplier", "No supplier", "medium"));
  if (!hasValue(license.contractNumber)) flags.push(riskFlag("no_contract", "No contract", "medium"));
  if (!hasValue(license.poNumber)) flags.push(riskFlag("no_po", "No PO", "low"));
  if (documentCount === 0) flags.push(riskFlag("no_documents", "No documents", "medium"));
  if (completenessPct !== null && completenessPct !== undefined && completenessPct < 100) {
    flags.push(riskFlag("incomplete", "Incomplete mandatory fields", "medium"));
  }
  if (highValueThreshold !== undefined && estimatedAnnualValue >= highValueThreshold) {
    flags.push(riskFlag("high_value", "High value", "high"));
  }
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

/** Mirrors support_renewal_service.open_support_renewal_filter: a support line that has not become a license yet. */
export function openSupportRenewalItems(parentLicenseId) {
  return store.sourcingItems.filter((item) => (
    item.maintenanceParentLicenseId === parentLicenseId
    && item.status !== "cancelled"
    && !store.licenses.some((license) => license.sourceSourcingItemId === item.id)
  ));
}

function selectSupportRenewalItem(parentLicenseId) {
  const items = openSupportRenewalItems(parentLicenseId).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  return items.find((item) => item.pendingOrderId != null) ?? items[0] ?? null;
}

function matchesWorkbenchView(row, view) {
  if (view === "all") return true;
  if (view === "needs_action") return ["expired_unresolved", "due_soon"].includes(row.renewalStatus);
  if (view === "overdue") return row.renewalStatus === "expired_unresolved";
  if (view === "due_30") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 30;
  if (view === "due_60") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 60;
  if (view === "due_90") return row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 90;
  if (view === "in_progress") return ["pending_renewal", "in_sourcing", "pending_order"].includes(row.renewalStatus);
  if (view === "missing_docs") return row.documentCount === 0;
  if (view === "high_value") return row.riskFlags.some((flag) => flag.code === "high_value");
  if (view === "notice_due") return row.daysUntilNotice !== null;
  return true;
}

function isWorkbenchCandidate(license, windowNumber) {
  if (license.isRetired || license.retirementScheduled || !isRenewableLicense(license)) return false;
  if (["renewed", "legacy"].includes(license.lifecycleStatus)) return false;
  if (license.lifecycleStatus === "pending_renewal") return true;
  const noticeDays = daysUntilNotice(license);
  if (noticeDays !== null && noticeDays <= windowNumber) return true;
  return Boolean(license.endDate) && daysUntil(license.endDate) <= windowNumber;
}

function isSupportCandidate(license, windowNumber) {
  return INCLUDED_SUPPORT_PARENT_TYPES.has(license.licenseType)
    && license.maintenanceCoverage === "included"
    && Boolean(license.maintenanceEndDate)
    && daysUntil(license.maintenanceEndDate) <= windowNumber
    && !license.isRetired
    && license.lifecycleStatus !== "legacy";
}

function workbenchRowBase(license, sourcingItem) {
  const pendingOrder = sourcingItem?.pendingOrderId != null
    ? store.pendingOrders.find((order) => order.id === sourcingItem.pendingOrderId)
    : null;
  return {
    licenseId: license.id,
    rowKind: "license",
    licenseRef: license.licenseRef,
    publisherName: license.publisherName,
    softwareDescription: license.softwareDescription,
    licenseType: license.licenseType,
    licenseMetric: license.licenseMetric,
    startDate: license.startDate,
    endDate: license.endDate,
    noticeDate: null,
    daysUntilNotice: null,
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
    completenessPct: computeLicenseCompletenessPct(license),
    documentCount: license.documentCount ?? 0,
    riskFlags: [],
    sourcingItemId: sourcingItem?.id ?? null,
    pendingOrderId: sourcingItem?.pendingOrderId ?? null,
    pendingOrderNumber: pendingOrder?.poNumber ?? null,
    customFields: license.customFields ?? [],
  };
}

function buildLicenseRow(license, thresholds) {
  const sourcingItem = selectRenewalSourcingItem(license.id);
  const daysUntilExpiry = daysUntil(license.endDate);
  const noticeDays = daysUntilNotice(license);
  const renewalStatus = computeRenewalStatus(license, sourcingItem, daysUntilExpiry);
  const row = {
    ...workbenchRowBase(license, sourcingItem),
    daysUntilExpiry,
    noticeDate: noticeDays !== null ? license.noticeDate : null,
    daysUntilNotice: noticeDays,
    renewalStatus,
    estimatedAnnualValue: estimateAnnualValue(license),
  };
  row.riskFlags = computeRenewalRiskFlags({
    license,
    renewalStatus,
    daysUntilExpiry,
    daysUntilNotice: noticeDays,
    documentCount: row.documentCount,
    estimatedAnnualValue: row.estimatedAnnualValue,
    highValueThreshold: thresholds[String(license.currency ?? "").trim().toUpperCase()],
  });
  return row;
}

/** Mirrors renewal_service._build_support_row: the included support period of a perpetual/OEM/freeware license. */
function buildSupportRow(parent, thresholds) {
  const sourcingItem = selectSupportRenewalItem(parent.id);
  const daysUntilExpiry = daysUntil(parent.maintenanceEndDate);
  let renewalStatus;
  if (sourcingItem?.pendingOrderId != null) renewalStatus = "pending_order";
  else if (sourcingItem) renewalStatus = "in_sourcing";
  else renewalStatus = daysUntilExpiry < 0 ? "expired_unresolved" : "due_soon";
  const row = {
    ...workbenchRowBase(parent, sourcingItem),
    rowKind: "support_renewal",
    softwareDescription: `${parent.softwareDescription} (included support)`,
    startDate: parent.maintenanceStartDate,
    endDate: parent.maintenanceEndDate,
    daysUntilExpiry,
    renewalStatus,
    estimatedAnnualValue: annualizeTermCost(
      parseDecimal(parent.maintenanceCost), parent.maintenanceStartDate, parent.maintenanceEndDate,
    ),
    customFields: [],
  };
  row.riskFlags = computeRenewalRiskFlags({
    license: parent,
    renewalStatus,
    daysUntilExpiry,
    documentCount: row.documentCount,
    estimatedAnnualValue: row.estimatedAnnualValue,
    highValueThreshold: thresholds[String(parent.currency ?? "").trim().toUpperCase()],
  });
  return row;
}

export function buildRenewalWorkbenchRows({ windowDays = 90, view = "all" } = {}) {
  if (!WORKBENCH_VIEWS.has(view)) throw new Error(`Unsupported workbench view: ${view}`);
  const windowNumber = Number(windowDays);
  if (!Number.isFinite(windowNumber) || windowNumber < 0) {
    throw new Error("window_days must be greater than or equal to 0");
  }

  const thresholds = highValueThresholds();
  const rows = [
    ...store.licenses
      .filter((license) => isWorkbenchCandidate(license, windowNumber))
      .map((license) => buildLicenseRow(license, thresholds)),
    ...store.licenses
      .filter((license) => isSupportCandidate(license, windowNumber))
      .map((parent) => buildSupportRow(parent, thresholds)),
  ];
  // Act on whichever deadline comes first: the notice date or the end date.
  rows.sort((a, b) => {
    const aDeadline = effectiveDeadlineDays(a);
    const bDeadline = effectiveDeadlineDays(b);
    if ((aDeadline === null) !== (bDeadline === null)) return aDeadline === null ? 1 : -1;
    if (aDeadline !== bDeadline) return (aDeadline ?? 0) - (bDeadline ?? 0);
    const byPublisher = String(a.publisherName).localeCompare(String(b.publisherName));
    return byPublisher !== 0 ? byPublisher : a.licenseId - b.licenseId;
  });
  return rows.filter((row) => matchesWorkbenchView(row, view));
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

/** Mirrors backend/app/schemas/pending_order.py SourcingItemSummary (nested-in-PO shape). */
export function toSourcingItemSummary(item) {
  return {
    id: item.id,
    sourcingRequestId: item.sourcingRequestId,
    publisherName: item.publisherName,
    softwareDescription: item.softwareDescription,
    licenseType: item.licenseType ?? null,
    licenseMetric: item.licenseMetric ?? null,
    isRenewable: item.isRenewable ?? null,
    typeDescription: item.typeDescription ?? null,
    maintenanceParentLicenseId: item.maintenanceParentLicenseId ?? null,
    maintenanceCoverage: item.maintenanceCoverage ?? null,
    maintenanceStartDate: item.maintenanceStartDate ?? null,
    maintenanceEndDate: item.maintenanceEndDate ?? null,
    maintenancePricingBasis: item.maintenancePricingBasis ?? null,
    maintenanceQuantity: item.maintenanceQuantity ?? null,
    maintenanceUnitPrice: item.maintenanceUnitPrice ?? null,
    maintenanceCost: item.maintenanceCost ?? null,
    parentSourcingItemId: item.parentSourcingItemId ?? null,
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
    successorSourcingItemId: item.successorSourcingItemId ?? null,
    cotermPredecessorIds: item.cotermPredecessorIds,
    quoteDocuments: [],
    isRenewal: item.renewalForLicenseId != null,
  };
}

/** Recomputes a pending order's items (from the live sourcingItems collection) and its totalPoValue. */
export function rebuildPendingOrderItems(order) {
  order.items = markPlannedRenewalLines(
    store.sourcingItems
      .filter((i) => i.pendingOrderId === order.id)
      .map(toSourcingItemSummary)
  );
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
    maintenanceParentLicenseId: item.maintenanceParentLicenseId ?? null,
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
  const items = markPlannedRenewalLines(
    store.sourcingItems
      .filter((i) => i.sourcingRequestId === request.id)
      .map(withSourcingItemLicenseRefs)
  );
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
    licenseMetric: payload.licenseMetric ?? null,
    portalUrl: payload.portalUrl ?? null,
    isRenewable: payload.isRenewable ?? null,
    typeDescription: payload.typeDescription ?? null,
    maintenanceParentLicenseId: payload.maintenanceParentLicenseId ?? null,
    maintenanceCoverage: payload.maintenanceCoverage ?? null,
    maintenanceStartDate: payload.maintenanceStartDate ?? null,
    maintenanceEndDate: payload.maintenanceEndDate ?? null,
    maintenancePricingBasis: payload.maintenancePricingBasis ?? null,
    maintenanceQuantity: payload.maintenanceQuantity ?? null,
    maintenanceUnitPrice: payload.maintenanceUnitPrice ?? null,
    maintenanceCost: payload.maintenanceCost ?? null,
    parentSourcingItemId: payload.parentSourcingItemId ?? null,
    successorSourcingItemId: payload.successorSourcingItemId ?? null,
    quantity: payload.quantity ?? null,
    quantityPerUnit: payload.quantityPerUnit ?? null,
    skuCode: payload.skuCode ?? null,
    estimatedUnitPrice: payload.licenseType === "freeware" ? null : payload.estimatedUnitPrice ?? null,
    estimatedTotalPrice: payload.licenseType === "freeware" ? null : payload.estimatedTotalPrice ?? null,
    currency: payload.currency || "EUR",
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    noticeDate: payload.noticeDate ?? null,
    purchaseDate: payload.purchaseDate ?? null,
    contractNumber: payload.contractNumber ?? null,
    invoiceNumber: payload.invoiceNumber ?? null,
    externalRef: payload.externalRef ?? null,
    supplier: payload.supplier ?? null,
    contactEmail: payload.contactEmail ?? null,
    costCentre: payload.costCentre ?? null,
    budgetOwnerEmail: payload.budgetOwnerEmail ?? null,
    secondaryContacts: payload.secondaryContacts ?? [],
    notes: payload.notes ?? null,
    customFieldValues: payload.customFieldValues ?? [],
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
  applyIncludedSupportDefaults(item);
  return normaliseTypeOptInFields(item);
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
    poTotalOverride: null,
    items: [],
    documents: [],
    totalPoValue: null,
  };
}

// Manual PO total on a pending order. Mirrors
// backend/app/services/po_total_override_service.py (1.1.24): only allowed
// while every line shares one currency, never spread across lines.
export const PENDING_ORDER_CURRENCY_DETAIL = (
  "A manual PO total needs every line of the pending order in one currency; "
  + "clear the PO total before adding a line in another currency"
);

const normalizeCurrency = (value) => String(value ?? "").trim().toUpperCase();

function pendingOrderLineCurrencies(orderId) {
  return new Set(
    store.sourcingItems
      .filter((item) => item.pendingOrderId === orderId && item.status !== "cancelled")
      .map((item) => normalizeCurrency(item.currency))
      .filter(Boolean)
  );
}

export function assertPendingOrderOverrideCurrencies(orderId) {
  if (pendingOrderLineCurrencies(orderId).size > 1) throw new Error(PENDING_ORDER_CURRENCY_DETAIL);
}

export function assertLineCurrencyFitsPendingOrder(orderId, currency) {
  const order = store.pendingOrders.find((candidate) => candidate.id === orderId);
  if (!order?.poTotalOverride) return;
  const currencies = pendingOrderLineCurrencies(orderId);
  if (currencies.size && !currencies.has(normalizeCurrency(currency))) {
    throw new Error(PENDING_ORDER_CURRENCY_DETAIL);
  }
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

  assertLineCurrencyFitsPendingOrder(order.id, item.currency);
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

  for (const item of purchaseItems) assertLineCurrencyFitsPendingOrder(order.id, item.currency);
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

  const actionDays = getRenewalActionDays();
  const licenses = orderedIds.map((id) => {
    const license = store.licenses.find((item) => item.id === id);
    if (!license) throw new Error(`License(s) not found: ${id}`);
    assertCanInitiateRenewal(license, { actionDays });
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
  const createdItemIds = [];
  for (const payload of payloads) {
    // Planned successors are a sourcing-request concept (pending_order_service.
    // _build_pending_order_item rejects successor_of_item_ids on PO lines).
    if ((payload.successorOfItemIds ?? []).length) {
      throw new Error("Successor lines must be added to a sourcing request");
    }
    assertLineCurrencyFitsPendingOrder(order.id, payload.currency || "EUR");
    const created = buildSourcingItem(
      { ...payload, renewalForLicenseId: null },
      { status: "converted", pendingOrderId: order.id, sourcingRequestId: null }
    );
    store.sourcingItems.push(created);
    createdItemIds.push(created.id);
  }
  rebuildPendingOrderItems(order);
  // The response carries the new line ids (PendingOrderResponse.created_item_ids)
  // without persisting them on the stored order (backend model_copy).
  return { ...order, createdItemIds };
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

/**
 * Mirrors backend/app/services/license_retirement_service.py:15-40
 * normalize_retirement_update (re-verified 2026-09-21 against 1.1.23). Translates
 * a retirement request into immediate retirement or an end-of-term schedule, and
 * materializes/keeps a schedule when a scheduled license's end date moves.
 * Mutates updateData in place (camelCase demo keys).
 */
export function normalizeRetirementUpdate(license, updateData) {
  const existingEnd = license ? license.endDate : null;
  const endDate = "endDate" in updateData ? updateData.endDate : existingEnd;
  const endDays = endDate == null || endDate === "" ? null : daysUntil(endDate);
  const hasRetirementRequest = "isRetired" in updateData;
  const wasScheduled = Boolean(license && license.retirementScheduled);

  if (hasRetirementRequest) {
    if (updateData.isRetired && endDays != null && endDays >= 0) {
      updateData.isRetired = false;
      updateData.retirementScheduled = true;
    } else {
      updateData.isRetired = Boolean(updateData.isRetired);
      updateData.retirementScheduled = false;
    }
    return;
  }
  if (wasScheduled && "endDate" in updateData) {
    const due = endDays == null || endDays < 0;
    updateData.isRetired = due;
    updateData.retirementScheduled = !due;
  }
}

/** Mirrors backend/app/services/license_response_service.py:45-51 get_renewal_action_days. */
export function getRenewalActionDays() {
  const configured = store.globalSettings.renewal_action_days;
  return Number(configured != null ? configured : store.globalSettings.notification_days);
}

/**
 * Mirrors backend/app/services/lifecycle_rules.py:100-128 assert_can_initiate_renewal
 * (re-verified 2026-09-21 against 1.1.23). The demo router carries no HTTP status
 * codes, so only the messages are mirrored (backend distinguishes 400/409).
 * Renewal is gated by an action window: renewal_action_days if configured, else
 * notification_days (get_renewal_action_days).
 */
export function assertCanInitiateRenewal(license, { actionDays, requireBudgetOwner = true } = {}) {
  const resolvedActionDays = actionDays != null ? actionDays : getRenewalActionDays();
  if (license.isRetired || license.retirementScheduled) {
    throw new Error("Retired licenses are not eligible for renewal");
  }
  if (license.lifecycleStatus === "pending_renewal") {
    throw new Error("Renewal already initiated for this license");
  }
  if (license.lifecycleStatus === "renewed") {
    throw new Error("License has already been renewed");
  }
  if (!isRenewableLicense(license)) {
    throw new Error("Cannot initiate renewal on a one-off service or other license; mark it renewable first");
  }
  if (requireBudgetOwner && !(license.budgetOwnerEmail || "").trim()) {
    throw new Error("A budget owner is required before initiating renewal");
  }
  assertPredecessorHasNoSuccessor(license);
  if (license.endDate == null || license.endDate === "") {
    throw new Error("Cannot initiate renewal on a perpetual license (no end date)");
  }
  if (license.startDate != null && license.startDate !== "" && daysUntil(license.startDate) > 0) {
    throw new Error("Upcoming licenses cannot start renewal");
  }
  if (daysUntil(license.endDate) > resolvedActionDays) {
    throw new Error(`Renewal actions are available ${resolvedActionDays} days before expiry`);
  }
}

/** Mirrors backend/app/services/lifecycle_rules.py:98-101 mark_predecessor_renewed. */
function markPredecessorRenewed(predecessor, successorId) {
  assertPredecessorHasNoSuccessor(predecessor);
  predecessor.lifecycleStatus = "renewed";
  predecessor.renewedToId = successorId;
  decorateLicense(predecessor);
}

// ---------------------------------------------------------------------------
// Planned multi-term succession between the lines of one procurement event.
// Mirrors backend/app/services/planned_successor_service.py (re-verified
// 2026-09-24 against 1.1.24: renewable Service/Other may chain, and maintenance
// terms chain with maintenance only). The demo router carries no HTTP status codes, so
// only the messages are mirrored. The one-request/one-order grouping is
// simplified to "one procurement event" because demo PO lines drop their
// sourcing_request_id on conversion; every caller-triggerable content guard
// (distinct/self/not-found/already-linked/publisher/type/cycle) is preserved.
// ---------------------------------------------------------------------------

// Types that never renew, regardless of the Service/Other renewable opt-in.
const NEVER_RENEWED_TYPES = new Set(["freeware", "perpetual"]);

function canTakePartInPlannedChain(item) {
  return isRenewableLicense(item) && !NEVER_RENEWED_TYPES.has(item.licenseType);
}

/**
 * Mark lines that are the planned successor of another line as renewals - the
 * response-time behavior of _mark_planned_renewal_lines on SourcingRequestResponse
 * and PendingOrderResponse. Mutates and returns the given items/summaries.
 */
export function markPlannedRenewalLines(items) {
  const successorIds = new Set(
    items.map((item) => item.successorSourcingItemId).filter((id) => id != null)
  );
  for (const item of items) {
    if (successorIds.has(item.id)) item.isRenewal = true;
  }
  return items;
}

/** Mirrors planned_successor_service.require_no_planned_links. */
export function requireNoPlannedLinks(item) {
  const incoming = store.sourcingItems.some((candidate) => candidate.successorSourcingItemId === item.id);
  if (item.successorSourcingItemId != null || incoming) {
    throw new Error("Remove this line's planned successor links first");
  }
}

function assertPlannedLinksAcyclic(allItems, changes) {
  const nextById = new Map(
    allItems.map((item) => [item.id, changes.has(item.id) ? changes.get(item.id) : item.successorSourcingItemId])
  );
  for (const start of nextById.keys()) {
    const seen = new Set();
    let current = start;
    while (current != null) {
      if (seen.has(current)) throw new Error("Successor links cannot form a cycle");
      seen.add(current);
      current = nextById.get(current) ?? null;
    }
  }
}

const plannedEventKey = (item) =>
  item.pendingOrderId != null ? `order:${item.pendingOrderId}` : `request:${item.sourcingRequestId}`;

/** Mirrors planned_successor_service.set_planned_successors. */
export function setPlannedSuccessors(predecessorItemIds, successorItemId) {
  if (!predecessorItemIds || predecessorItemIds.length === 0
    || predecessorItemIds.length !== new Set(predecessorItemIds).size) {
    throw new Error("Choose one or more distinct predecessor lines");
  }
  const targetIds = new Set(predecessorItemIds);
  if (successorItemId != null) targetIds.add(successorItemId);
  const selected = new Map();
  for (const id of targetIds) {
    const item = store.sourcingItems.find((candidate) => candidate.id === id);
    if (!item) throw new Error("A selected sourcing line was not found");
    selected.set(id, item);
  }
  if (successorItemId != null && predecessorItemIds.includes(successorItemId)) {
    throw new Error("A line cannot succeed itself");
  }

  const predecessors = predecessorItemIds.map((id) => selected.get(id));
  const successor = successorItemId != null ? selected.get(successorItemId) : null;
  if (successor != null && predecessors.some(
    (p) => p.successorSourcingItemId != null && p.successorSourcingItemId !== successorItemId)) {
    throw new Error("A predecessor already has a planned next term");
  }
  if (successor != null && (successor.renewalForLicenseId != null
    || (successor.cotermPredecessorIds && successor.cotermPredecessorIds.length))) {
    throw new Error("The successor line already follows existing licenses");
  }

  const events = new Set([...selected.values()].map(plannedEventKey));
  if (events.size !== 1
    || [...selected.values()].some((item) => item.sourcingRequestId == null && item.pendingOrderId == null)) {
    throw new Error("Linked lines must belong to one procurement event");
  }
  const orderId = [...selected.values()][0].pendingOrderId;
  let allItems;
  if (orderId == null) {
    if ([...selected.values()].some((item) => item.status !== "sourcing")) {
      throw new Error("Linked sourcing lines must still be open");
    }
    const requestId = [...selected.values()][0].sourcingRequestId;
    allItems = store.sourcingItems.filter((item) => item.sourcingRequestId === requestId);
  } else {
    const order = store.pendingOrders.find((candidate) => candidate.id === orderId);
    if (!order || (order.status !== "pending" && order.status !== "invoice_received")) {
      throw new Error("The pending order is no longer editable");
    }
    allItems = store.sourcingItems.filter((item) => item.pendingOrderId === orderId);
  }

  if (successor != null) {
    const successorPublisher = normalized(successor.publisherName);
    if (!successorPublisher) throw new Error("Successor publisher is required");
    if (!canTakePartInPlannedChain(successor)) {
      throw new Error("This successor type cannot be renewed");
    }
    for (const predecessor of predecessors) {
      if (normalized(predecessor.publisherName) !== successorPublisher) {
        throw new Error("Linked terms must have the same publisher");
      }
      if (!canTakePartInPlannedChain(predecessor)) {
        throw new Error("This predecessor type cannot be renewed");
      }
      // Support chains stay support: maintenance follows maintenance only.
      if ((predecessor.licenseType === "maintenance") !== (successor.licenseType === "maintenance")) {
        throw new Error("Maintenance terms can only follow maintenance terms");
      }
    }
  }

  const changes = new Map(predecessorItemIds.map((id) => [id, successorItemId]));
  assertPlannedLinksAcyclic(allItems, changes);
  const now = new Date().toISOString();
  for (const predecessor of predecessors) {
    predecessor.successorSourcingItemId = successorItemId;
    predecessor.updatedAt = now;
  }
}

/** Mirrors planned_successor_service.replace_planned_predecessors. */
export function replacePlannedPredecessors(predecessorItemIds, successorItemId) {
  const successor = store.sourcingItems.find((item) => item.id === successorItemId);
  if (!successor) throw new Error("Successor line was not found");
  const desired = new Set(predecessorItemIds);
  if (desired.size !== predecessorItemIds.length) {
    throw new Error("Choose distinct predecessor lines");
  }
  const currentIds = store.sourcingItems
    .filter((item) => item.successorSourcingItemId === successorItemId)
    .map((item) => item.id);
  const removed = currentIds.filter((id) => !desired.has(id)).sort((a, b) => a - b);
  if (removed.length) setPlannedSuccessors(removed, null);
  if (predecessorItemIds.length) setPlannedSuccessors(predecessorItemIds, successorItemId);
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

/**
 * Included maintenance derives its detail fields from the license term when the
 * caller did not submit them explicitly (renewal_workflow.py:246-253).
 * submittedFields is the set of keys the caller actually sent.
 */
function applyIncludedSupportTermFallback(data, submittedFields = new Set()) {
  if (data.maintenanceCoverage !== "included") return data;
  if (!submittedFields.has("maintenanceStartDate") && submittedFields.has("startDate")) {
    data.maintenanceStartDate = data.startDate;
  }
  if (!submittedFields.has("maintenanceEndDate") && submittedFields.has("endDate")) {
    data.maintenanceEndDate = data.endDate;
  }
  if (!submittedFields.has("maintenanceCost") && submittedFields.has("totalPoPrice")) {
    data.maintenanceCost = data.totalPoPrice;
  }
  return data;
}

/**
 * Mirrors backend/app/services/renewal_workflow.py:150-256
 * build_pending_order_item_license_data (re-verified 2026-09-21 against 1.1.23).
 * submittedFields is the set of keys the caller actually sent (raw payload keys,
 * before convert defaults were filled in), mirroring the schema's
 * model_fields_set that the backend threads through to the included-support
 * fallback below.
 */
function buildPendingOrderItemLicenseData(formData, item, oldLicense, submittedFields = new Set()) {
  const data = { ...formData };

  data.publisherName = item.publisherName;
  data.softwareDescription = item.softwareDescription;
  data.requestDate = item.createdAt;

  if (item.quantity != null) data.quantity = item.quantity;
  if (item.quantityPerUnit != null) data.quantityPerUnit = item.quantityPerUnit;
  if (item.licenseMetric != null) data.licenseMetric = item.licenseMetric;
  if (item.portalUrl != null) data.portalUrl = item.portalUrl;
  if (item.skuCode != null) data.skuCode = item.skuCode;
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
  for (const field of [
    "startDate", "endDate", "noticeDate", "purchaseDate", "contractNumber",
    "invoiceNumber", "externalRef", "costCentre", "budgetOwnerEmail",
    "secondaryContacts", "notes",
  ]) {
    if (item[field] != null && item[field] !== "") data[field] = item[field];
  }
  for (const field of ["isRenewable", "typeDescription"]) {
    if (submittedFields.has(field)) continue;
    const value = item[field] ?? oldLicense?.[field] ?? null;
    if (value !== null && value !== "") data[field] = value;
  }

  applyIncludedSupportTermFallback(data, submittedFields);

  if (oldLicense != null) {
    data.notes = null;
    data.licenseType = oldLicense.licenseType;
    data.licenseMetric = oldLicense.licenseMetric;
    if (oldLicense.licenseType === "maintenance") data.parentLicenseId = oldLicense.parentLicenseId;
    if (oldLicense.skuCode) data.skuCode = oldLicense.skuCode;
    if (oldLicense.costCentre) data.costCentre = oldLicense.costCentre;
    // The line's stored owner is the truth. Only a single-predecessor line falls
    // back to that predecessor; merged coterm lines never inherit the primary's owner.
    const singlePredecessor = (item.cotermPredecessorIds ?? []).length < 2;
    if (singlePredecessor && !submittedFields.has("budgetOwnerEmail") && !hasValue(item.budgetOwnerEmail)
      && oldLicense.budgetOwnerEmail) {
      data.budgetOwnerEmail = oldLicense.budgetOwnerEmail;
    }
  }
  // A maintenance line started from a license (e.g. Start support renewal) supports that license.
  if (data.licenseType === "maintenance" && !submittedFields.has("parentLicenseId")
    && data.parentLicenseId == null && item.maintenanceParentLicenseId != null) {
    data.parentLicenseId = item.maintenanceParentLicenseId;
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
 * Mirrors backend/app/services/conversion/license_converter.py
 * create_purchase_license (re-verified 2026-09-24 against 1.1.24):
 * non-expiring types drop the end date, Other needs a type description, and a
 * maintenance record with a parentLicenseId is linked to that license and
 * becomes its active support on its own start date. Parents resolved through
 * parentSourcingItemId (a parent bought on the same PO) are not linked in the demo.
 */
function createPurchaseLicense(itemData, itemId = null) {
  const data = { ...itemData };
  delete data.parentSourcingItemId;
  normaliseLicenseTypeFields(data);
  if (typeDescriptionMissing(data.licenseType, data.typeDescription)) {
    throw new Error(itemId != null ? `Item ${itemId}: ${TYPE_DESCRIPTION_REQUIRED_DETAIL}` : TYPE_DESCRIPTION_REQUIRED_DETAIL);
  }
  if (data.licenseType !== "maintenance" && data.parentLicenseId != null) {
    throw new Error("parentLicenseId is only valid for maintenance licenses");
  }
  data.maintenanceCoverage = data.maintenanceCoverage || defaultMaintenanceCoverage(data.licenseType);
  applyIncludedSupportDefaults(data);
  const license = buildConvertedLicense(data);
  if (license.licenseType === "maintenance" && license.parentLicenseId != null && license.parentLicenseId !== "") {
    const parent = store.licenses.find((candidate) => candidate.id === Number(license.parentLicenseId));
    if (parent) linkOrActivateMaintenance(license, parent);
  }
  return license;
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
  applyIncludedSupportDefaults(data);
  normaliseLicenseTypeFields(data);
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
  // A maintenance renewal supports the same licenses; a future-dated term is
  // linked now and handed over on its start date (renewal_orchestrator
  // _activate_maintenance_successor_for_all_parents).
  if (successor.licenseType === "maintenance") {
    for (const parentId of maintenanceParentIdsOf(oldLic)) {
      const parent = store.licenses.find((license) => license.id === parentId);
      if (parent) linkOrActivateMaintenance(successor, parent);
    }
  }
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
  // Keys the caller actually sent, captured before convert defaults are filled in.
  const submittedFields = new Set(Object.keys(payload ?? {}));
  const formData = {
    ...normalizeConvertPayload(payload),
    pendingOrderId: order.id,
    purchaseDate: order.createdAt,
    ...(orderSupplier ? { supplier: orderSupplier } : {}),
    // The order's manual total is the truth for every license it creates; line
    // prices are never changed or spread.
    ...(order.poTotalOverride ? { poTotalOverride: order.poTotalOverride } : {}),
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
        const itemData = buildPendingOrderItemLicenseData(formData, item, oldLic, submittedFields);
        itemData.sourceSourcingItemId = item.id;
        requireBudgetOwnerForSplitCoterm(item, itemData);
        const { successor, predecessorIds: marked } = createRenewalSuccessorFromSourcingItem(item, itemData);
        newLicenseEntries.push([successor, "renewed"]);
        predecessorIds.push(...marked);
      } else {
        const itemData = buildPendingOrderItemLicenseData(formData, item, null, submittedFields);
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
  const planned = applyPlannedSuccessorLinks(items);
  predecessorIds.push(...planned.predecessorIds);
  refreshOrderStatus(order);
  rebuildPendingOrderItems(order);
  order.updatedAt = now;

  return buildConversionResponse(markPlannedRenewals(newLicenseEntries, planned.successorIds), predecessorIds);
}

function markPlannedRenewals(newLicenseEntries, plannedSuccessorIds) {
  return newLicenseEntries.map(([license, type]) => [license, plannedSuccessorIds.has(license.id) ? "renewed" : type]);
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
    const submittedFields = new Set(Object.keys(rest));
    const itemData = {
      ...normalizeConvertPayload(rest),
      pendingOrderId: order.id,
      sourceSourcingItemId: sourcingItem.id,
      requestDate: sourcingItem.createdAt,
      purchaseDate: order.createdAt,
      ...(orderSupplier ? { supplier: orderSupplier } : {}),
      ...(order.poTotalOverride ? { poTotalOverride: order.poTotalOverride } : {}),
    };
    applyIncludedSupportTermFallback(itemData, submittedFields);
    if (itemData.licenseType === "maintenance" && !submittedFields.has("parentLicenseId")
      && sourcingItem.maintenanceParentLicenseId != null) {
      itemData.parentLicenseId = sourcingItem.maintenanceParentLicenseId;
    }
    requireBudgetOwnerForSplitCoterm(sourcingItem, itemData, `Item ${batchItem.sourcingItemId}: `);

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
      newLicenseEntries.push([createPurchaseLicense(itemData, batchItem.sourcingItemId), "new_purchase"]);
    }
    sourcingItem.status = "converted";
    sourcingItem.updatedAt = now;
  }

  // Planned maintenance chains convert head first; a term without its own
  // parent supports the same license as its predecessor term.
  const resolvedParents = new Map();
  for (const [sourcingItem, itemData] of maintenanceChainOrder(pendingMaintenanceItems, orderItems)) {
    inheritChainParent(itemData, sourcingItem, orderItems, resolvedParents);
    resolvedParents.set(sourcingItem.id, itemData.parentLicenseId ?? null);
    newLicenseEntries.push([createPurchaseLicense(itemData, sourcingItem.id), "new_purchase"]);
    sourcingItem.status = "converted";
    sourcingItem.updatedAt = now;
  }

  const planned = applyPlannedSuccessorLinks(orderItems);
  predecessorIds.push(...planned.predecessorIds);
  refreshOrderStatus(order);
  rebuildPendingOrderItems(order);
  order.updatedAt = now;

  return buildConversionResponse(markPlannedRenewals(newLicenseEntries, planned.successorIds), predecessorIds);
}

// ---------------------------------------------------------------------------
// Support lifecycle (1.1.24). Mirrors backend/app/services/maintenance_service.py
// (activate_maintenance_for_parent, link_or_activate_maintenance,
// hand_over_due_maintenance, record_included_support_exit),
// support_renewal_service.py, license_write_service.apply_included_support_update
// and license_retirement_service.retire_due_licenses (re-verified 2026-09-24).
// Coverage history is not kept in the demo, so the snapshot steps are omitted.
// ---------------------------------------------------------------------------

function maintenanceParentIdsOf(maintenance) {
  return [...new Set([maintenance.parentLicenseId, ...(maintenance.maintenanceParentIds || [])]
    .filter((id) => id != null)
    .map(Number))];
}

function linkMaintenanceToParent(maintenance, parent) {
  if (!(maintenance.maintenanceParentIds || []).some((id) => Number(id) === Number(parent.id))) {
    maintenance.maintenanceParentIds = [...(maintenance.maintenanceParentIds || []), parent.id];
  }
  if (maintenance.parentLicenseId == null) maintenance.parentLicenseId = parent.id;
  if (!(parent.linkedMaintenanceIds || []).some((id) => Number(id) === Number(maintenance.id))) {
    parent.linkedMaintenanceIds = [...(parent.linkedMaintenanceIds || []), maintenance.id];
  }
}

/** Make a maintenance record the parent's active support; the parent mirrors the record's term and line total. */
export function activateMaintenanceForParent(maintenance, parent) {
  linkMaintenanceToParent(maintenance, parent);
  parent.activeMaintenanceId = maintenance.id;
  parent.hasMaintenance = true;
  parent.maintenanceCoverage = "separately_tracked";
  parent.maintenanceStartDate = maintenance.startDate;
  parent.maintenanceEndDate = maintenance.endDate;
  parent.maintenancePricingBasis = null;
  parent.maintenanceQuantity = null;
  parent.maintenanceUnitPrice = null;
  const total = lineTotal(maintenance);
  parent.maintenanceCost = hasValue(maintenance.quantity) && hasValue(maintenance.unitPrice) ? total.toFixed(2) : null;
  decorateLicense(maintenance);
  decorateLicense(parent);
}

const startsAfterToday = (license) => Boolean(license.startDate) && daysUntil(license.startDate) > 0;

/** A support record covers the parent now unless something else still does and it starts later. */
function shouldBecomeActiveNow(maintenance, parent) {
  if (parent.activeMaintenanceId == null || parent.activeMaintenanceId === maintenance.id) return true;
  if (!startsAfterToday(maintenance)) return true;
  const active = store.licenses.find((license) => license.id === parent.activeMaintenanceId);
  if (!active || active.isRetired) return true;
  if (active.endDate && daysUntil(active.endDate) < 0) return true;
  return startsAfterToday(active) && active.startDate > maintenance.startDate;
}

/** Link a support record to a parent, activating it only if it should cover the parent today. */
export function linkOrActivateMaintenance(maintenance, parent) {
  if (shouldBecomeActiveNow(maintenance, parent)) {
    activateMaintenanceForParent(maintenance, parent);
    return true;
  }
  linkMaintenanceToParent(maintenance, parent);
  decorateLicense(maintenance);
  decorateLicense(parent);
  return false;
}

const coversToday = (license) => (
  !license.isRetired
  && (!license.startDate || daysUntil(license.startDate) <= 0)
  && (!license.endDate || daysUntil(license.endDate) >= 0)
);

/** Daily job: each parent's current support record becomes active once its term starts. */
export function handOverDueMaintenance() {
  const bestByParent = new Map();
  for (const candidate of store.licenses.filter((license) => license.licenseType === "maintenance" && coversToday(license))) {
    for (const parentId of maintenanceParentIdsOf(candidate)) {
      const best = bestByParent.get(parentId);
      const key = (license) => `${license.startDate ?? "0000-00-00"}|${String(license.id).padStart(12, "0")}`;
      if (!best || key(candidate) > key(best)) bestByParent.set(parentId, candidate);
    }
  }
  let handedOver = 0;
  for (const [parentId, candidate] of bestByParent) {
    const parent = store.licenses.find((license) => license.id === parentId);
    if (!parent || parent.isRetired || parent.activeMaintenanceId === candidate.id) continue;
    const active = store.licenses.find((license) => license.id === parent.activeMaintenanceId);
    if (active && coversToday(active)) continue;
    activateMaintenanceForParent(candidate, parent);
    handedOver++;
  }
  return handedOver;
}

/** Daily job: materialize due scheduled retirements and retire ended one-off Service/Other records. */
export function retireDueLicenses() {
  let retired = 0;
  for (const license of store.licenses) {
    if (license.isRetired || !license.endDate || daysUntil(license.endDate) >= 0) continue;
    const scheduledDue = license.retirementScheduled;
    const endedOneOff = isRenewalOptInLicenseType(license.licenseType)
      && license.isRenewable !== true
      && !license.retirementScheduled
      && license.lifecycleStatus !== "legacy";
    if (!scheduledDue && !endedOneOff) continue;
    license.isRetired = true;
    license.retirementScheduled = false;
    decorateLicense(license);
    retired++;
  }
  return retired;
}

/** The backend scheduler's daily license jobs, run once when the demo session starts. */
export function runDailyLicenseJobs() {
  return { retired: retireDueLicenses(), handedOver: handOverDueMaintenance() };
}

/**
 * When coverage leaves Included with no active record, the parent's stale
 * included-support mirrors are cleared (the backend first snapshots them into
 * coverage history, which the demo does not keep).
 */
export function recordIncludedSupportExit(license, previousCoverage) {
  if (previousCoverage !== "included" || license.maintenanceCoverage === "included") return;
  if (license.activeMaintenanceId != null) return;
  license.hasMaintenance = false;
  license.maintenanceStartDate = null;
  license.maintenanceEndDate = null;
  license.maintenancePricingBasis = null;
  license.maintenanceQuantity = null;
  license.maintenanceUnitPrice = null;
  license.maintenanceCost = null;
}

const CANONICAL_MONEY = /^\d+(\.\d+)?$/;

/** Mirrors PUT /api/licenses/{id}/included-support (IncludedSupportUpdate + apply_included_support_update). */
export function applyIncludedSupportUpdate(license, payload = {}) {
  const blankToNull = (value) => (value === "" || value === undefined ? null : value);
  const startDate = blankToNull(payload.maintenanceStartDate);
  const endDate = blankToNull(payload.maintenanceEndDate);
  const pricingBasis = payload.maintenancePricingBasis || "flat";
  const money = {};
  for (const field of ["maintenanceQuantity", "maintenanceUnitPrice", "maintenanceCost"]) {
    const value = blankToNull(payload[field]);
    if (value !== null && (typeof value !== "string" || !CANONICAL_MONEY.test(value))) {
      throw new Error("Amounts must be plain decimal strings (e.g. '1234.50').");
    }
    money[field] = value;
  }
  if (startDate && endDate && endDate < startDate) throw new Error("Support end date cannot be before its start date.");
  if (!INCLUDED_SUPPORT_PARENT_TYPES.has(license.licenseType)) {
    throw new Error("Included support can only be edited on perpetual, OEM or freeware licenses");
  }
  if (license.maintenanceCoverage !== "included") {
    throw new Error("Set coverage to Included before editing the support period");
  }
  if (license.activeMaintenanceId != null) {
    throw new Error("Support is tracked on a linked maintenance record; edit that record instead");
  }
  const perUnit = pricingBasis === "per_unit";
  license.maintenanceStartDate = startDate;
  license.maintenanceEndDate = endDate;
  license.maintenancePricingBasis = pricingBasis;
  license.maintenanceQuantity = perUnit ? money.maintenanceQuantity : null;
  license.maintenanceUnitPrice = perUnit ? money.maintenanceUnitPrice : null;
  license.maintenanceCost = money.maintenanceCost;
  decorateLicense(license);
  return license;
}

/**
 * Mirrors backend/app/services/support_renewal_service.py start_support_renewal:
 * one sourcing request with a maintenance line that carries the supported
 * license. Coverage stays Included until the new record exists.
 */
export function startSupportRenewal(parent) {
  if (!INCLUDED_SUPPORT_PARENT_TYPES.has(parent.licenseType)) {
    throw new Error("Support renewal applies to perpetual, OEM and freeware licenses");
  }
  if (parent.maintenanceCoverage !== "included" || !parent.maintenanceEndDate) {
    throw new Error("This license has no included support period with an end date");
  }
  if (parent.isRetired || parent.lifecycleStatus === "legacy") {
    throw new Error("Retired or legacy licenses cannot start a support renewal");
  }
  if (openSupportRenewalItems(parent.id).length) {
    throw new Error("A support renewal is already in progress for this license");
  }
  const startDate = addDaysIso(parent.maintenanceEndDate, 1);
  const previousCost = parseDecimal(parent.maintenanceCost) > 0 ? parent.maintenanceCost : null;
  const item = buildSourcingItem({
    publisherName: parent.publisherName,
    softwareDescription: `${parent.softwareDescription} Maintenance`,
    licenseType: "maintenance",
    licenseMetric: parent.licenseMetric || "per_user",
    maintenanceCoverage: "not_applicable",
    quantity: parent.quantity || null,
    quantityPerUnit: parent.quantityPerUnit || "1",
    estimatedUnitPrice: null,
    estimatedTotalPrice: previousCost,
    currency: parent.currency,
    supplier: parent.supplier || null,
    contactEmail: parent.contactEmail || null,
    costCentre: parent.costCentre || null,
    budgetOwnerEmail: parent.budgetOwnerEmail || null,
    secondaryContacts: [...(parent.secondaryContacts || [])],
    startDate,
    endDate: termEnd(startDate),
    notes: `Support renewal for ${parent.licenseRef || parent.softwareDescription}.`,
    maintenanceParentLicenseId: parent.id,
  });
  store.sourcingItems.push(item);
  ensureSourcingRequestForItem(item);
  return item;
}

/** Force an explicit budget owner when merged coterm predecessors disagree. */
function requireBudgetOwnerForSplitCoterm(item, data, detailPrefix = "") {
  const predecessorIds = item.cotermPredecessorIds ?? [];
  if (predecessorIds.length < 2 || String(data.budgetOwnerEmail ?? "").trim()) return;
  const owners = new Set(
    predecessorIds
      .map((id) => store.licenses.find((license) => license.id === id)?.budgetOwnerEmail)
      .filter((owner) => owner && owner.trim())
      .map((owner) => owner.trim().toLowerCase())
  );
  if (owners.size > 1) {
    throw new Error(`${detailPrefix}Choose a budget owner: the merged licenses had different budget owners`);
  }
}

/** Order maintenance lines so every planned predecessor converts before its successor. */
function maintenanceChainOrder(pending, orderItems) {
  const predecessorOf = new Map(
    orderItems
      .filter((item) => item.successorSourcingItemId != null)
      .map((item) => [item.successorSourcingItemId, item.id])
  );
  const depth = (itemId) => {
    const seen = new Set();
    let steps = 0;
    let current = itemId;
    while (predecessorOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = predecessorOf.get(current);
      steps++;
    }
    return steps;
  };
  return [...pending].sort((a, b) => depth(a[0].id) - depth(b[0].id));
}

/** A planned maintenance term without its own parent supports the same license as its predecessor. */
function inheritChainParent(itemData, sourcingItem, orderItems, resolvedParents) {
  if (itemData.parentLicenseId != null && itemData.parentLicenseId !== "") return;
  const predecessor = orderItems.find((item) => item.successorSourcingItemId === sourcingItem.id);
  if (!predecessor || !resolvedParents.has(predecessor.id)) return;
  const parentLicenseId = resolvedParents.get(predecessor.id);
  if (parentLicenseId != null) itemData.parentLicenseId = parentLicenseId;
}

/**
 * Mirrors backend/app/services/conversion/planned_successors.py
 * apply_planned_successor_links: after every PO line exists as a license, each
 * planned next term becomes the renewal successor of its predecessor line(s).
 */
function applyPlannedSuccessorLinks(orderItems) {
  const incoming = new Map();
  const itemIds = new Set(orderItems.map((item) => item.id));
  for (const item of orderItems) {
    const targetId = item.successorSourcingItemId;
    if (targetId == null) continue;
    if (!itemIds.has(targetId)) throw new Error(`Line ${item.id} has a successor outside this PO`);
    incoming.set(targetId, [...(incoming.get(targetId) ?? []), item.id]);
  }
  const successorIds = new Set();
  const predecessorIds = [];
  if (!incoming.size) return { successorIds, predecessorIds };

  const licenseForItem = (itemId) => store.licenses.find((license) => license.sourceSourcingItemId === itemId);
  const remaining = new Set(incoming.keys());
  while (remaining.size) {
    const ready = [...remaining]
      .filter((targetId) => !incoming.get(targetId).some((sourceId) => remaining.has(sourceId)))
      .sort((a, b) => a - b);
    if (!ready.length) throw new Error("Planned successor links contain a cycle");
    for (const targetId of ready) {
      const successor = licenseForItem(targetId);
      const predecessors = incoming.get(targetId).map(licenseForItem);
      if (!successor || predecessors.some((license) => !license)) {
        throw new Error("Every linked PO line must create one license");
      }
      predecessors.sort((a, b) => String(a.startDate ?? "9999").localeCompare(String(b.startDate ?? "9999")) || a.id - b.id);
      if (!canTakePartInPlannedChain(successor)) throw new Error(`Line ${targetId} cannot be a renewal successor`);
      for (const predecessor of predecessors) {
        assertPredecessorHasNoSuccessor(predecessor);
        if (normalized(predecessor.publisherName) !== normalized(successor.publisherName)) {
          throw new Error(`Line ${targetId} must match predecessor publisher`);
        }
        if (!canTakePartInPlannedChain(predecessor)) throw new Error(`Line ${targetId} follows a nonrenewable license`);
        if ((predecessor.licenseType === "maintenance") !== (successor.licenseType === "maintenance")) {
          throw new Error(`Line ${targetId}: maintenance terms can only follow maintenance terms`);
        }
        if (!successor.endDate) throw new Error("Renewal successor must have an end date");
        if (predecessor.endDate && successor.endDate <= predecessor.endDate) {
          throw new Error("Renewal successor must extend coverage beyond every predecessor end date");
        }
        if (predecessor.startDate && (!successor.startDate || successor.startDate <= predecessor.startDate)) {
          throw new Error("Renewal successor must start after every predecessor start date");
        }
      }
      const primary = predecessors[0];
      successor.renewedFromId = primary.id;
      successor.predecessorId = primary.id;
      if (predecessors.length > 1) successor.cotermFromIds = predecessors.map((license) => license.id);
      successor.licenseRef = primary.licenseRef;
      for (const predecessor of predecessors) {
        markPredecessorRenewed(predecessor, successor.id);
        predecessorIds.push(predecessor.id);
      }
      decorateLicense(successor);
      successorIds.add(successor.id);
      remaining.delete(targetId);
    }
  }
  return { successorIds, predecessorIds };
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
  runDailyLicenseJobs();
  store.seeded = true;
}

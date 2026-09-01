import { NON_ENTITLEMENT_LICENSE_TYPES, NON_EXPIRING_LICENSE_TYPES } from "../constants/licenseData.js";

// Permission Helpers
export const isAdmin = (user) => user?.role === "admin";
export const isEditorOrAdmin = (user) => user?.role === "admin" || user?.role === "editor";
export const canEdit = (user) => isEditorOrAdmin(user);
export const todayStr = () => new Date().toISOString().split("T")[0];
export const daysBetween = (a, b) => Math.ceil((new Date(b) - new Date(a)) / 86400000);

const CURRENCY_ALIASES = { EURO: "EUR" };

export const formatCost = (value, currency = "USD", locale = "en-US") => {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (isNaN(num)) return "—";
  const code = CURRENCY_ALIASES[currency] ?? currency ?? "USD";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return String(value);
  }
};

export function formatCostByCurrency(byCurrency, locale = "en-US", { includeNegative = false, includeZero = false } = {}) {
  if (!byCurrency) return "—";
  const entries = Object.entries(byCurrency).filter(([, value]) => {
    const amount = Number(value);
    return Number.isFinite(amount) && (amount > 0 || (includeNegative && amount < 0) || (includeZero && amount === 0));
  });
  if (entries.length === 0) return "—";
  return entries
    .map(([currency, amount]) => formatCost(amount, currency, locale))
    .join(" · ");
}

/** Format signed reconciliation amounts without combining native currencies. */
export function formatSignedCostByCurrency(byCurrency, locale = "en-US") {
  return formatCostByCurrency(byCurrency, locale, { includeNegative: true, includeZero: true });
}

export function formatPriceInput(value, locale = "en-US") {
  if (value === "" || value === null || value === undefined) return "";
  const num = parseFloat(String(value).replace(",", "."));
  if (isNaN(num)) return value;
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return value;
  }
}

export const getPoTotal = (poNumber, currency, allLicenses) => {
  if (!poNumber || !currency) return 0;
  const matching = allLicenses.filter(
    (license) => license.poNumber === poNumber && license.currency === currency && !license.retired,
  );
  const override = matching.find((l) => l.poTotalOverride !== null && l.poTotalOverride !== undefined && l.poTotalOverride !== "");
  if (override) return Number(override.poTotalOverride) || 0;
  return matching
    .reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0);
};

export const getEffectiveQuantity = (license) => {
  if (license?.effectiveQuantity != null && license.effectiveQuantity !== "") return license.effectiveQuantity;
  const quantity = Number(license?.quantity);
  const quantityPerUnit = Number(license?.quantityPerUnit || 1);
  if (!Number.isFinite(quantity) || !Number.isFinite(quantityPerUnit)) return "";
  return String(quantity * quantityPerUnit);
};

const FREEWARE_ALWAYS_INAPPLICABLE_FIELDS = new Set([
  "contactEmail",
  "entitlement",
  "eula",
]);

const FREEWARE_PURCHASE_FIELDS = new Set([
  "invoice",
  "invoiceNumber",
  "contractNumber",
  "poNumber",
  "purchaseOrder",
  "quote",
]);

const ENTITLEMENT_DOCUMENT_FIELDS = new Set(["entitlement", "eula"]);

const hasPaidIncludedSupport = (license) =>
  license.maintenanceCoverage === "included" &&
  Number(license.maintenanceCost) > 0;

export const getCompleteness = (license, mandatoryFields) => {
  const fieldMap = {
    invoice: { label: "Invoice document", check: () => license.documents?.invoice?.length > 0 },
    eula: { label: "EULA document", check: () => license.documents?.eula?.length > 0 },
    entitlement: { label: "Proof of entitlement", check: () => license.documents?.entitlement?.length > 0 },
    purchaseOrder: { label: "Purchase order document", check: () => license.documents?.purchase_order?.length > 0 },
    quote: { label: "Quote document", check: () => license.documents?.quote?.length > 0 },
    startDate: { label: "Start date", check: () => !!license.startDate },
    endDate: { label: "End date / Non-expiring type", check: () => !!license.endDate || NON_EXPIRING_LICENSE_TYPES.includes(license.licenseType) },
    noticeDate: { label: "Notice date", check: () => !!license.noticeDate },
    contractNumber: { label: "Contract number", check: () => !!license.contractNumber },
    poNumber: { label: "PO number", check: () => !!license.poNumber },
    invoiceNumber: { label: "Invoice number", check: () => !!license.invoiceNumber },
    contactEmail: { label: "Publisher contact", check: () => !!license.contactEmail },
    costCentre: { label: "Department / Cost Centre", check: () => !!license.costCentre },
    budgetOwnerEmail: { label: "Budget owner email", check: () => !!license.budgetOwnerEmail },
  };
  const checks = [];
  for (const [key, { label, check }] of Object.entries(fieldMap)) {
    const applies = !(NON_ENTITLEMENT_LICENSE_TYPES.includes(license.licenseType) && ENTITLEMENT_DOCUMENT_FIELDS.has(key)) &&
      (license.licenseType !== "freeware" ||
      (
        !FREEWARE_ALWAYS_INAPPLICABLE_FIELDS.has(key) &&
        (!FREEWARE_PURCHASE_FIELDS.has(key) || hasPaidIncludedSupport(license))
      ));
    if (mandatoryFields[key] && applies) {
      checks.push({ field: label, met: check(), mandatory: true });
    }
  }
  const met = checks.filter((c) => c.met);
  return { percentage: checks.length > 0 ? Math.round((met.length / checks.length) * 100) : 100, checks, isComplete: met.length === checks.length };
};

export const getExpirationStatus = (
  endDate,
  notificationDays,
  retired,
  lifecycleStatus,
  renewedToId,
  startDate = null,
  licenseType = null,
  successorStartDate = null,
) => {
  if (retired) return { status: "retired", days: null, label: "Retired" };
  if (lifecycleStatus === "legacy") return { status: "legacy", days: null, label: "Legacy" };
  if (lifecycleStatus === "pending_renewal") return { status: "pending_renewal", days: null, label: "Pending Renewal" };
  if (startDate) {
    const daysUntilStart = daysBetween(todayStr(), startDate);
    if (daysUntilStart > 0) return { status: "upcoming", days: daysUntilStart, label: `Starts in ${daysUntilStart}d` };
  }
  if (!endDate || endDate === "Perpetual") {
    if (!licenseType || NON_EXPIRING_LICENSE_TYPES.includes(licenseType)) {
      return { status: "perpetual", days: null, label: "Perpetual" };
    }
    return { status: "active", days: null, label: "Active" };
  }
  const days = daysBetween(todayStr(), endDate);
  // End date passed - either renewed (successor exists) or expired (no successor)
  if (days < 0) {
    const successorHasStarted = !successorStartDate || daysBetween(todayStr(), successorStartDate) <= 0;
    if (renewedToId && successorHasStarted) return { status: "renewed", days: Math.abs(days), label: "Renewed" };
    if (!renewedToId && lifecycleStatus === "renewed") return { status: "renewed", days: Math.abs(days), label: "Renewed" };
    return { status: "expired", days: Math.abs(days), label: `Expired ${Math.abs(days)}d ago` };
  }
  if (days <= notificationDays) return { status: "expiring", days, label: `Expires in ${days}d` };
  return { status: "active", days, label: `${days}d remaining` };
};

// Map an API license response to the shape the frontend expects.
export const normalizeLicense = (l) => ({
  ...l,
  invoiceNumber: l.invoiceNumber ?? l.invoiceNumbers?.[0] ?? "",
  invoiceNumbers: Array.isArray(l.invoiceNumbers)
    ? l.invoiceNumbers.filter(Boolean)
    : (l.invoiceNumber ? [l.invoiceNumber] : []),
  secondaryContacts: Array.isArray(l.secondaryContacts) ? l.secondaryContacts.filter(Boolean) : [],
  licenseRefAliases: Array.isArray(l.licenseRefAliases) ? l.licenseRefAliases.filter(Boolean) : [],
  quantityPerUnit: l.quantityPerUnit ?? l.quantity_per_unit ?? "1",
  effectiveQuantity: l.effectiveQuantity ?? l.effective_quantity ?? "",
  // API uses isRetired; frontend uses retired
  retired: l.isRetired ?? l.retired ?? false,
  // API returns null for no end date; frontend uses "" for perpetual display
  endDate: l.endDate ?? "",
  startDate: l.startDate ?? "",
  noticeDate: l.noticeDate ?? "",
  noticeHandledAt: l.noticeHandledAt ?? "",
  noticeHandledByUserId: l.noticeHandledByUserId ?? null,
  // Documents are not in the license list response (separate endpoint)
  documents: l.documents ?? { invoice: [], eula: [], entitlement: [], purchase_order: [], quote: [] },
  availableDocumentCount: l.availableDocumentCount ?? l.available_document_count ?? l.documentCount ?? 0,
  missingDocumentCount: l.missingDocumentCount ?? l.missing_document_count ?? 0,
  unavailableDocumentCount: l.unavailableDocumentCount ?? l.unavailable_document_count ?? 0,
  maintenanceCoverage: l.maintenanceCoverage ?? (
    ["maintenance", "service", "other"].includes(l.licenseType)
      ? "not_applicable"
      : ["subscription", "saas"].includes(l.licenseType)
        ? "included"
        : "unknown"
  ),
  maintenanceParentIds: Array.isArray(l.maintenanceParentIds) ? l.maintenanceParentIds : [],
  linkedMaintenanceIds: Array.isArray(l.linkedMaintenanceIds) ? l.linkedMaintenanceIds : [],
  isCompletenessExempt: l.isCompletenessExempt ?? false,
  renewalNotificationsEnabled: l.renewalNotificationsEnabled ?? true,
});

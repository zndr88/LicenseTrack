export const WINDOW_DAYS = 90;

export const VIEW_OPTIONS = [
  { key: "all",          label: "All",          color: null                  },
  { key: "needs_action", label: "Needs Action", color: "var(--orange)"       },
  { key: "overdue",      label: "Overdue",      color: "var(--red)"          },
  { key: "due_30",       label: "30",           color: "var(--orange)"       },
  { key: "due_60",       label: "60",           color: "var(--orange)"       },
  { key: "due_90",       label: "90",           color: "var(--orange)"       },
  { key: "in_progress",  label: "In Progress",  color: "var(--purple-text)"  },
  { key: "missing_docs", label: "Missing Docs", color: "var(--orange)"       },
  { key: "high_value",   label: "High Value",   color: "var(--green)"        },
];

export const STATUS_LABELS = {
  expired_unresolved: "Expired",
  due_soon: "Due Soon",
  pending_renewal: "Pending Renewal",
  in_sourcing: "In Sourcing",
  pending_order: "PO Pending",
};

export const STATUS_BADGE_CLASS = {
  expired_unresolved: "badge-red",
  due_soon: "badge-orange",
  pending_renewal: "badge-pending",
  in_sourcing: "badge-blue",
  pending_order: "badge-pending",
};

export const RISK_CLASS = {
  high: "badge-red",
  medium: "badge-orange",
  low: "badge-gray",
};

export const IN_PROGRESS_STATUSES = new Set(["pending_renewal", "in_sourcing", "pending_order"]);
export const HIGH_VALUE_THRESHOLD = 50000;

export const EMPTY_COPY = {
  all: "No renewal candidates.",
  needs_action: "No renewals currently need action.",
  overdue: "No overdue renewals.",
  due_30: "No renewals are due in the next 30 days.",
  due_60: "No renewals are due in the next 60 days.",
  due_90: "No renewals are due in the next 90 days.",
  in_progress: "No renewals are in progress.",
  missing_docs: "No renewals are missing documents.",
  high_value: "No high-value renewals in this window.",
};

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = {
  expired_unresolved: 0,
  due_soon: 1,
  pending_renewal: 2,
  in_sourcing: 3,
  pending_order: 4,
};
const RISK_PRIORITY = {
  expired: 0,
  renewal_not_started: 1,
  due_30: 2,
  high_value: 3,
  due_60: 4,
  incomplete: 5,
  no_supplier: 6,
  no_contract: 7,
  no_documents: 8,
  no_po: 9,
  pending_order: 10,
  due_90: 11,
};

export function sortText(value) {
  return String(value ?? "").toLowerCase();
}

export function getCustomFields(row) {
  return Array.isArray(row?.customFields) ? row.customFields.filter(Boolean) : [];
}

export function includesSearch(row, query) {
  if (!query) return true;
  // Search includes all custom field values, even when their column is hidden,
  // so imported metadata remains discoverable without changing the table shape.
  const customValues = getCustomFields(row).flatMap((field) => [
    field.name,
    field.valueText,
    field.valueCurrency,
  ]);
  const haystack = [
    row.publisherName,
    row.softwareDescription,
    row.licenseRef,
    row.supplier,
    row.budgetOwnerEmail,
    ...customValues,
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function dueWithin(row, max) {
  return row.daysUntilExpiry !== null &&
    row.daysUntilExpiry !== undefined &&
    row.daysUntilExpiry >= 0 &&
    row.daysUntilExpiry <= max;
}

function hasRisk(row, code) {
  return (row.riskFlags ?? []).some((flag) => flag.code === code);
}

function highestSeverityScore(row) {
  return Math.min(...(row.riskFlags ?? []).map((flag) => SEVERITY_RANK[flag.severity] ?? 3), 3);
}

export function getViewCounts(rows, highValueThreshold = HIGH_VALUE_THRESHOLD) {
  return {
    all: rows.length,
    needs_action: rows.filter((row) => ["expired_unresolved", "due_soon"].includes(row.renewalStatus)).length,
    overdue: rows.filter((row) => row.renewalStatus === "expired_unresolved").length,
    due_30: rows.filter((row) => dueWithin(row, 30)).length,
    due_60: rows.filter((row) => dueWithin(row, 60)).length,
    due_90: rows.filter((row) => dueWithin(row, 90)).length,
    in_progress: rows.filter((row) => IN_PROGRESS_STATUSES.has(row.renewalStatus)).length,
    missing_docs: rows.filter((row) => row.documentCount === 0).length,
    high_value: rows.filter((row) => Number(row.estimatedAnnualValue ?? 0) >= highValueThreshold || hasRisk(row, "high_value")).length,
  };
}

export function prioritySortRows(rows) {
  return [...rows].sort((a, b) => {
    const aExpired = a.daysUntilExpiry !== null && a.daysUntilExpiry !== undefined && a.daysUntilExpiry < 0;
    const bExpired = b.daysUntilExpiry !== null && b.daysUntilExpiry !== undefined && b.daysUntilExpiry < 0;
    if (aExpired !== bExpired) return aExpired ? -1 : 1;

    const aInProgress = IN_PROGRESS_STATUSES.has(a.renewalStatus);
    const bInProgress = IN_PROGRESS_STATUSES.has(b.renewalStatus);
    if (!aExpired && !bExpired && aInProgress !== bInProgress) return aInProgress ? 1 : -1;

    const aDays = a.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
    const bDays = b.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
    if (aDays !== bDays) return aDays - bDays;

    const aHighSeverity = highestSeverityScore(a);
    const bHighSeverity = highestSeverityScore(b);
    if (aHighSeverity !== bHighSeverity) return aHighSeverity - bHighSeverity;

    const bValue = Number(b.estimatedAnnualValue ?? 0);
    const aValue = Number(a.estimatedAnnualValue ?? 0);
    if (aValue !== bValue) return bValue - aValue;

    const statusDiff = (STATUS_RANK[a.renewalStatus] ?? 9) - (STATUS_RANK[b.renewalStatus] ?? 9);
    if (statusDiff !== 0) return statusDiff;

    const publisherDiff = sortText(a.publisherName).localeCompare(sortText(b.publisherName));
    if (publisherDiff !== 0) return publisherDiff;

    return (a.licenseId ?? 0) - (b.licenseId ?? 0);
  });
}

export function orderRiskFlags(flags = []) {
  return [...flags].sort((a, b) => {
    const severityDiff = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
    if (severityDiff !== 0) return severityDiff;
    const priorityDiff = (RISK_PRIORITY[a.code] ?? 99) - (RISK_PRIORITY[b.code] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return sortText(a.label).localeCompare(sortText(b.label));
  });
}

export function getRiskFlagDisplay(flags = [], limit = 3) {
  const ordered = orderRiskFlags(flags);
  return {
    visible: ordered.slice(0, limit),
    hidden: ordered.slice(limit),
  };
}

export function getPrimaryAction(row, { canOpenPipeline, canStartRenewal }) {
  const inProgress = IN_PROGRESS_STATUSES.has(row.renewalStatus);
  if (canOpenPipeline && row.pendingOrderId) return "po";
  if (canOpenPipeline && row.sourcingItemId) return "sourcing";
  if (canStartRenewal && !inProgress && row.budgetOwnerEmail?.trim()) return "start";
  return null;
}

export function rowTone(row) {
  if (row.renewalStatus === "expired_unresolved") {
    return { background: "var(--red-dim)", borderLeft: "3px solid var(--red)" };
  }
  if (row.renewalStatus === "due_soon" && row.daysUntilExpiry <= 30) {
    return { background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)" };
  }
  if (IN_PROGRESS_STATUSES.has(row.renewalStatus)) {
    return { background: "var(--purple-dim)", borderLeft: "3px solid var(--purple)" };
  }
  return undefined;
}

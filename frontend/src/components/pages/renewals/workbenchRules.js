export const WINDOW_DAYS = 90;

export const VIEW_OPTIONS = [
  { key: "all",          label: "All",          color: null                  },
  { key: "needs_action", label: "Needs Action", color: "var(--orange)"       },
  { key: "overdue",      label: "Overdue",      color: "var(--red)"          },
  { key: "due_30",       label: "30 Days",      color: "var(--orange)"       },
  { key: "due_60",       label: "60 Days",      color: "var(--orange)"       },
  { key: "due_90",       label: "90 Days",      color: "var(--orange)"       },
  { key: "notice_due",   label: "Notice Due",   color: "var(--orange)"       },
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

export const EMPTY_COPY = {
  all: "No renewal candidates.",
  needs_action: "No renewals currently need action.",
  overdue: "No overdue renewals.",
  due_30: "No renewals are due in the next 30 days.",
  due_60: "No renewals are due in the next 60 days.",
  due_90: "No renewals are due in the next 90 days.",
  notice_due: "No unhandled notice deadlines in this window.",
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
  notice_passed: 1,
  renewal_not_started: 2,
  notice_due: 3,
  due_30: 4,
  high_value: 5,
  due_60: 6,
  incomplete: 7,
  no_supplier: 8,
  no_contract: 9,
  no_documents: 10,
  no_po: 11,
  pending_order: 12,
  due_90: 13,
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

function isOverdue(row) {
  return row.daysUntilExpiry !== null &&
    row.daysUntilExpiry !== undefined &&
    row.daysUntilExpiry < 0;
}

function hasValue(value) {
  return value !== null && value !== undefined;
}

/** True when the unhandled notice deadline comes before (or instead of) the end date. */
export function noticeIsEarlierDeadline(row) {
  return hasValue(row.daysUntilNotice) && (!hasValue(row.daysUntilExpiry) || row.daysUntilNotice < row.daysUntilExpiry);
}

/** Days to the earlier of the notice deadline and the end date. */
export function effectiveDeadlineDays(row) {
  return noticeIsEarlierDeadline(row) ? row.daysUntilNotice : row.daysUntilExpiry;
}

function hasRisk(row, code) {
  return (row.riskFlags ?? []).some((flag) => flag.code === code);
}

function highestSeverityScore(row) {
  return Math.min(...(row.riskFlags ?? []).map((flag) => SEVERITY_RANK[flag.severity] ?? 3), 3);
}

/**
 * Per-currency high-value check; a currency without a configured threshold is
 * never high value (no FX conversion). The backend flag stays authoritative.
 */
export function isHighValueRow(row, highValueThresholds = {}) {
  if (hasRisk(row, "high_value")) return true;
  const threshold = highValueThresholds?.[String(row.currency || "").toUpperCase()];
  if (threshold === undefined || threshold === null || threshold === "") return false;
  return Number(row.estimatedAnnualValue ?? 0) >= Number(threshold);
}

export function getViewCounts(rows, highValueThresholds = {}) {
  return {
    all: rows.length,
    needs_action: rows.filter((row) => ["expired_unresolved", "due_soon"].includes(row.renewalStatus)).length,
    overdue: rows.filter(isOverdue).length,
    due_30: rows.filter((row) => dueWithin(row, 30)).length,
    due_60: rows.filter((row) => dueWithin(row, 60)).length,
    due_90: rows.filter((row) => dueWithin(row, 90)).length,
    notice_due: rows.filter((row) => hasValue(row.daysUntilNotice)).length,
    in_progress: rows.filter((row) => IN_PROGRESS_STATUSES.has(row.renewalStatus)).length,
    missing_docs: rows.filter((row) => row.documentCount === 0).length,
    high_value: rows.filter((row) => isHighValueRow(row, highValueThresholds)).length,
  };
}

export function prioritySortRows(rows) {
  return [...rows].sort((a, b) => {
    const aExpired = isOverdue(a);
    const bExpired = isOverdue(b);
    if (aExpired !== bExpired) return aExpired ? -1 : 1;

    const aInProgress = IN_PROGRESS_STATUSES.has(a.renewalStatus);
    const bInProgress = IN_PROGRESS_STATUSES.has(b.renewalStatus);
    if (!aExpired && !bExpired && aInProgress !== bInProgress) return aInProgress ? 1 : -1;

    const aDays = effectiveDeadlineDays(a) ?? Number.MAX_SAFE_INTEGER;
    const bDays = effectiveDeadlineDays(b) ?? Number.MAX_SAFE_INTEGER;
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

export function isSupportRow(row) {
  return row?.rowKind === "support_renewal";
}

export function workbenchRowKey(row) {
  return `${row.rowKind || "license"}-${row.licenseId}`;
}

export function getPrimaryAction(row, { canOpenPipeline, canStartRenewal, renewalActionDays = 30 }) {
  const inProgress = IN_PROGRESS_STATUSES.has(row.renewalStatus);
  if (canOpenPipeline && row.pendingOrderId) return "po";
  if (canOpenPipeline && row.sourcingItemId) return "sourcing";
  // Included support ending: procurement is the primary route.
  if (isSupportRow(row)) return canStartRenewal && !inProgress ? "start_support" : null;
  if (
    canStartRenewal
    && !inProgress
    && row.budgetOwnerEmail?.trim()
    && row.daysUntilExpiry !== null
    && row.daysUntilExpiry !== undefined
    && row.daysUntilExpiry <= renewalActionDays
  ) return "start";
  return null;
}

export function rowTone(row) {
  if (isOverdue(row)) {
    return {
      background: IN_PROGRESS_STATUSES.has(row.renewalStatus) ? "var(--purple-dim)" : "var(--red-dim)",
      borderLeft: "3px solid var(--red)",
    };
  }
  if (row.renewalStatus === "due_soon" && row.daysUntilExpiry <= 30) {
    return { background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)" };
  }
  if (IN_PROGRESS_STATUSES.has(row.renewalStatus)) {
    return { background: "var(--purple-dim)", borderLeft: "3px solid var(--purple)" };
  }
  return undefined;
}

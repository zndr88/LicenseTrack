// Registry grouping: pure helpers that turn the filtered, sorted license list
// into a two-level group tree and the rows the table renders.
import { LICENSE_TYPES } from "../../../constants/licenseData.js";
import { getLineAmount } from "../../../utils/lineAmount.js";
import {
  getIndexedProcurementBreakdown,
  indexProcurementLines,
  normalizeProcurementPoNumber,
  procurementIdentityKey,
} from "../../../utils/procurementIdentity.js";
import { EXPIRATION_ORDER } from "../../../utils/sort.js";

export const MAX_GROUP_LEVELS = 2;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const STATUS_LABELS = {
  active: "Active",
  perpetual: "Perpetual",
  upcoming: "Upcoming",
  expiring: "Expiring",
  expired: "Expired",
  pending_renewal: "Pending Renewal",
  renewed: "Renewed",
  retired: "Retired",
  legacy: "Legacy",
  unknown: "Unknown",
};

function trimmed(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function textColumn(key, label, blankLabel, read, normalize = (text) => text.toLowerCase()) {
  return {
    key,
    label,
    blankLabel,
    read: (license) => {
      const text = trimmed(read(license));
      return text === null ? null : { key: normalize(text), label: text };
    },
    compare: (a, b) => collator.compare(a.label, b.label),
  };
}

export const GROUPABLE_COLUMNS = Object.freeze([
  textColumn("poNumber", "PO #", "(No PO #)", (l) => l.poNumber, normalizeProcurementPoNumber),
  textColumn("publisher", "Publisher", "(No publisher)", (l) => l.publisherName),
  textColumn("supplier", "Supplier", "(No supplier)", (l) => l.supplier || "Direct"),
  textColumn("costCentre", "Cost Centre", "(No cost centre)", (l) => l.costCentre),
  {
    key: "licenseType",
    label: "Type",
    blankLabel: "(No type)",
    read: (l) => {
      const type = trimmed(l.licenseType);
      if (type === null) return null;
      return { key: type, label: LICENSE_TYPES.find((t) => t.value === type)?.label ?? type };
    },
    compare: (a, b) => collator.compare(a.label, b.label),
  },
  {
    key: "startYear",
    label: "Start year",
    blankLabel: "(No start date)",
    read: (l) => {
      const year = /^\d{4}/.exec(String(l.startDate ?? ""))?.[0];
      return year ? { key: year, label: year } : null;
    },
    compare: (a, b) => Number(a.key) - Number(b.key),
  },
  {
    key: "endYear",
    label: "End year",
    blankLabel: "(No end date)",
    read: (l) => {
      const year = /^\d{4}/.exec(String(l.endDate ?? ""))?.[0];
      return year ? { key: year, label: year } : null;
    },
    compare: (a, b) => Number(a.key) - Number(b.key),
  },
  {
    key: "status",
    label: "Status",
    blankLabel: "(No status)",
    read: (l) => {
      const status = trimmed(l.expiration?.status ?? l.expirationStatus);
      return status === null ? null : { key: status, label: STATUS_LABELS[status] ?? status };
    },
    compare: (a, b) => (EXPIRATION_ORDER[a.key] ?? 99) - (EXPIRATION_ORDER[b.key] ?? 99),
  },
  {
    key: "currency",
    label: "Currency",
    blankLabel: "(No currency)",
    read: (l) => {
      const code = trimmed(l.currency)?.toUpperCase() ?? null;
      return code === null ? null : { key: code, label: code };
    },
    compare: (a, b) => collator.compare(a.label, b.label),
  },
  textColumn("contractNumber", "Contract #", "(No contract #)", (l) => l.contractNumber),
  textColumn("budgetOwnerEmail", "Budget Owner", "(No budget owner)", (l) => l.budgetOwnerEmail),
]);

const COLUMN_BY_KEY = new Map(GROUPABLE_COLUMNS.map((column) => [column.key, column]));

export function getGroupableColumn(key) {
  return COLUMN_BY_KEY.get(key) ?? null;
}

// Table column key -> grouping key, where they differ.
const COLUMN_TO_GROUPING = { startDate: "startYear", endDate: "endYear", expiration: "status" };

/** The grouping a dragged table column maps to, or null when it can't be grouped. */
export function groupingKeyForColumn(columnKey) {
  const key = COLUMN_TO_GROUPING[columnKey] ?? columnKey;
  return COLUMN_BY_KEY.has(key) ? key : null;
}

export function sanitizeGroupBy(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const key of value) {
    if (COLUMN_BY_KEY.has(key) && !result.includes(key)) result.push(key);
    if (result.length === MAX_GROUP_LEVELS) break;
  }
  return result;
}

const ENDED_STATUSES = new Set(["renewed", "retired", "legacy"]);
const BLANK = "\u0000blank";

function groupValue(column, license) {
  return column.read(license) ?? { key: null, label: column.blankLabel };
}

function partition(lines, column) {
  const byKey = new Map();
  for (const license of lines) {
    const value = groupValue(column, license);
    const mapKey = value.key ?? BLANK;
    if (!byKey.has(mapKey)) byKey.set(mapKey, { key: value.key, label: value.label, lines: [] });
    byKey.get(mapKey).lines.push(license);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return column.compare(a, b);
  });
}

function addAmount(byCurrency, currency, amount) {
  byCurrency[currency] = (byCurrency[currency] ?? 0) + amount;
}

function summarize(columnKey, shownLines, allGroupLines, procurementIndex, fallbackCurrency) {
  const lineSumByCurrency = {};
  let earliestEndDate = null;
  for (const license of shownLines) {
    const amount = getLineAmount(license);
    if (amount !== null) addAmount(lineSumByCurrency, license.currency || fallbackCurrency, amount);
    const status = license.expiration?.status ?? license.expirationStatus;
    if (license.endDate && !ENDED_STATUSES.has(status) && (earliestEndDate === null || license.endDate < earliestEndDate)) {
      earliestEndDate = license.endDate;
    }
  }

  let poTotalByCurrency = null;
  let poOverrideMismatch = false;
  if (columnKey === "poNumber") {
    poTotalByCurrency = {};
    const seen = new Set();
    for (const license of allGroupLines) {
      const identity = procurementIdentityKey(license);
      if (identity === null || seen.has(identity.join("|"))) continue;
      seen.add(identity.join("|"));
      const { lineSum, override, total } = getIndexedProcurementBreakdown(license, procurementIndex);
      addAmount(poTotalByCurrency, identity[1], total);
      if (override !== null && Math.abs(override - lineSum) > 0.005) poOverrideMismatch = true;
    }
  }

  return {
    shownCount: shownLines.length,
    totalCount: allGroupLines.length,
    lineSumByCurrency,
    earliestEndDate,
    poTotalByCurrency,
    poOverrideMismatch,
  };
}

function buildLevel(shownLines, allLines, groupBy, depth, parentId, procurementIndex, fallbackCurrency) {
  const column = getGroupableColumn(groupBy[depth]);
  const allByKey = new Map(partition(allLines, column).map((group) => [group.key ?? BLANK, group.lines]));
  return partition(shownLines, column).map((group) => {
    const id = `${parentId ? `${parentId}/` : ""}${column.key}:${group.key ?? "(blank)"}`;
    const allGroupLines = allByKey.get(group.key ?? BLANK) ?? group.lines;
    const isLast = depth === groupBy.length - 1;
    return {
      id,
      columnKey: column.key,
      columnLabel: column.label,
      key: group.key,
      label: group.label,
      depth,
      lines: group.lines,
      children: isLast
        ? []
        : buildLevel(group.lines, allGroupLines, groupBy, depth + 1, id, procurementIndex, fallbackCurrency),
      summary: summarize(column.key, group.lines, allGroupLines, procurementIndex, fallbackCurrency),
    };
  });
}

/**
 * Group the filtered, sorted lines. `allLicenses` is the unfiltered, enriched
 * list: it gives the "of N lines" counts and the PO figures.
 */
export function groupLicenses(sortedLines, groupBy, { allLicenses = sortedLines, fallbackCurrency = "EUR" } = {}) {
  const levels = sanitizeGroupBy(groupBy);
  if (levels.length === 0) return [];
  // Only PO groups need the purchase figures, so index only when one is asked for.
  const procurementIndex = levels.includes("poNumber") ? indexProcurementLines(allLicenses) : new Map();
  return buildLevel(sortedLines, allLicenses, levels, 0, "", procurementIndex, fallbackCurrency);
}

/** Display rows for the table: group headers, plus lines of open leaf groups. */
export function flattenGroups(nodes, expandedIds) {
  const rows = [];
  const visit = (list) => {
    for (const node of list) {
      rows.push({ type: "group", node });
      if (!expandedIds.has(node.id)) continue;
      if (node.children.length > 0) visit(node.children);
      else for (const license of node.lines) rows.push({ type: "line", license, depth: node.depth + 1 });
    }
  };
  visit(nodes);
  return rows;
}

/** Every shown line in grouped order (used for CSV export). */
export function groupedLines(nodes) {
  return nodes.flatMap((node) => (node.children.length > 0 ? groupedLines(node.children) : node.lines));
}

/** Ids of the groups (outer to inner) that contain the license, or []. */
export function findGroupPathIds(nodes, licenseId) {
  for (const node of nodes) {
    if (!node.lines.some((license) => license.id === licenseId)) continue;
    return [node.id, ...findGroupPathIds(node.children, licenseId)];
  }
  return [];
}

/** Ids of every group at every level (for Expand all). */
export function allGroupIds(nodes) {
  return nodes.flatMap((node) => [node.id, ...allGroupIds(node.children)]);
}

import { buildCsvContent, downloadCsv } from "../../../utils/csvDownload.js";
import { getCustomFieldValue } from "./workbenchColumns.js";
import {
  STATUS_LABELS,
  effectiveDeadlineDays,
  noticeIsEarlierDeadline,
  orderRiskFlags,
} from "./workbenchRules.js";

export const WORKBENCH_EXPORT_FILENAME = "renewal_workbench_export.csv";

const isoDate = (value) => (value ? String(value).slice(0, 10) : "");
const decimal = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "";
};

function customFieldCell(row, column) {
  const field = getCustomFieldValue(row, column);
  if (!field) return "";
  const raw = field.valueCurrency ?? field.valueText;
  if (raw === null || raw === undefined) return "";
  if (field.fieldType === "currency") return decimal(raw);
  if (field.fieldType === "date" && /^\d{4}-\d{2}-\d{2}/.test(String(raw))) return isoDate(raw);
  return String(raw);
}

// One table column can become several CSV columns, so each cell stays one plain value.
const BUILT_IN_EXPORT = {
  dueDate: [
    ["Due Date", (row) => isoDate(noticeIsEarlierDeadline(row) ? row.noticeDate : row.endDate)],
    ["Deadline Type", (row) => (noticeIsEarlierDeadline(row) ? "Notice deadline" : "End date")],
  ],
  // Negative means overdue. Written as a number, not as "5d overdue".
  days: [["Days", (row) => effectiveDeadlineDays(row) ?? ""]],
  license: [
    ["Publisher", (row) => row.publisherName ?? ""],
    ["Software Description", (row) => row.softwareDescription ?? ""],
  ],
  licenseRef: [["License Ref", (row) => row.licenseRef ?? ""]],
  supplier: [["Supplier", (row) => row.supplier ?? ""]],
  budgetOwner: [["Budget Owner", (row) => row.budgetOwnerEmail ?? ""]],
  // The amount always travels with its own currency code; nothing is converted or summed.
  value: [
    ["Estimated Annual Value", (row) => decimal(row.estimatedAnnualValue)],
    ["Currency", (row) => row.currency ?? ""],
  ],
  status: [["Status", (row) => STATUS_LABELS[row.renewalStatus] ?? row.renewalStatus ?? ""]],
  riskFlags: [["Risk Flags", (row) => orderRiskFlags(row.riskFlags ?? []).map((flag) => flag.label).join("; ")]],
};

/**
 * CSV text for the workbench as shown: the given rows in the given order and
 * the visible columns (the Actions column has nothing to export).
 *
 * Same conventions as the Sourcing and Pending Orders exports: dates as
 * YYYY-MM-DD, amounts with a "." decimal and no thousands separator, and the
 * currency as an ISO code in its own column.
 */
export function buildWorkbenchCsv(rows, columns) {
  const exportColumns = columns.flatMap((column) => {
    if (column.isCustom) return [[column.label, (row) => customFieldCell(row, column)]];
    return BUILT_IN_EXPORT[column.id] ?? [];
  });
  return buildCsvContent(
    exportColumns.map(([header]) => header),
    rows.map((row) => exportColumns.map(([, cell]) => cell(row))),
  );
}

export function exportWorkbenchCsv(rows, columns) {
  downloadCsv(WORKBENCH_EXPORT_FILENAME, buildWorkbenchCsv(rows, columns));
}

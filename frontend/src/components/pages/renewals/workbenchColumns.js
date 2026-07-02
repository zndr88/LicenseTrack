import {
  formatCustomFieldValue,
  getCustomColumnId,
} from "../../../utils/customFieldPresentation.js";
import { getCustomFields, sortText } from "./workbenchRules.js";
import { formatDate as formatDateUtil } from "../../../utils/formatting.js";

export const REQUIRED_COLUMN_IDS = new Set(["license", "dueDate", "status", "actions"]);

export const BUILT_IN_COLUMNS = [
  { id: "dueDate", label: "Due Date", required: true, defaultVisible: true },
  { id: "days", label: "Days", required: false, defaultVisible: true },
  { id: "license", label: "Publisher / Software", required: true, defaultVisible: true },
  { id: "licenseRef", label: "License Ref", required: false, defaultVisible: true },
  { id: "supplier", label: "Supplier", required: false, defaultVisible: true },
  { id: "budgetOwner", label: "Budget Owner", required: false, defaultVisible: true },
  { id: "value", label: "Value", required: false, defaultVisible: true },
  { id: "status", label: "Status", required: true, defaultVisible: true },
  { id: "riskFlags", label: "Risk Flags", required: false, defaultVisible: true },
  { id: "actions", label: "Actions", required: true, defaultVisible: true },
];

export function formatDate(value, userSettings) {
  if (!value) return "-";
  return formatDateUtil(value, userSettings) || "-";
}

function formatCustomDate(value, userSettings) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return formatDate(String(value).slice(0, 10), userSettings);
  return String(value);
}

function getLegacyCustomColumnId(def) {
  const fieldKey = def?.fieldKey ?? def?.field_key;
  return fieldKey ? `custom:${fieldKey}` : null;
}

export function getCustomFieldValue(row, column) {
  const fieldKeys = column?.fieldKeys ?? [column?.fieldKey];
  return getCustomFields(row).find((field) => fieldKeys.includes(field.fieldKey)) ?? null;
}

export function discoverCustomFieldColumns(rows = [], definitions = []) {
  const byKey = new Map();
  for (const definition of definitions) {
    const fieldKey = definition?.fieldKey ?? definition?.field_key;
    if (!fieldKey) continue;
    const columnId = getCustomColumnId(definition);
    const legacyId = getLegacyCustomColumnId(definition);
    byKey.set(columnId, {
      id: columnId,
      legacyIds: legacyId ? [legacyId] : [],
      fieldKey,
      fieldKeys: [fieldKey],
      label: definition.name || fieldKey,
      fieldType: definition.fieldType ?? definition.field_type ?? "text",
      section: definition.section || "",
      required: false,
      defaultVisible: false,
      isCustom: true,
    });
  }

  for (const row of rows) {
    for (const field of getCustomFields(row)) {
      if (!field?.fieldKey) continue;
      const columnId = getCustomColumnId(field);
      const legacyId = getLegacyCustomColumnId(field);
      if (byKey.has(columnId)) {
        const existing = byKey.get(columnId);
        if (!existing.fieldKeys.includes(field.fieldKey)) existing.fieldKeys.push(field.fieldKey);
        if (legacyId && !existing.legacyIds.includes(legacyId)) existing.legacyIds.push(legacyId);
        continue;
      }
      byKey.set(columnId, {
        id: columnId,
        legacyIds: legacyId ? [legacyId] : [],
        fieldKey: field.fieldKey,
        fieldKeys: [field.fieldKey],
        label: field.name || field.fieldKey,
        fieldType: field.fieldType || "text",
        section: field.section || "",
        required: false,
        defaultVisible: false,
        isCustom: true,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const sectionDiff = sortText(a.section).localeCompare(sortText(b.section));
    if (sectionDiff !== 0) return sectionDiff;
    return sortText(a.label).localeCompare(sortText(b.label));
  });
}

export function buildWorkbenchColumns(rows = [], definitions = []) {
  return [...BUILT_IN_COLUMNS, ...discoverCustomFieldColumns(rows, definitions)];
}

export function getVisibleWorkbenchColumns(columns, savedVisibility = {}) {
  return columns.filter((column) => {
    if (column.required || REQUIRED_COLUMN_IDS.has(column.id)) return true;
    if (Object.prototype.hasOwnProperty.call(savedVisibility, column.id)) {
      return savedVisibility[column.id] !== false;
    }
    for (const legacyId of column.legacyIds ?? []) {
      if (Object.prototype.hasOwnProperty.call(savedVisibility, legacyId)) {
        return savedVisibility[legacyId] !== false;
      }
    }
    return column.defaultVisible === true;
  });
}

export function renderCustomFieldDisplay(field, row, locale = "en-US", userSettings = null) {
  if (!field) return "-";
  const raw = field.valueCurrency ?? field.valueText;
  if (raw === null || raw === undefined || raw === "") return "-";
  if (field.fieldType === "date") return formatCustomDate(raw, userSettings);
  return formatCustomFieldValue(raw, field, {
    blankDisplay: "-",
    currency: row.currency,
    locale,
  });
}

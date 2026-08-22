import { LICENSE_METRICS, LICENSE_TYPES, MAINTENANCE_COVERAGE_OPTIONS } from "../constants/licenseData.js";
import { getPoTotal } from "./helpers.js";

const labelFor = (options, value) => options.find((option) => option.value === value)?.label ?? value ?? null;
export const finiteNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
export const dateOnlyValue = (value) => {
  if (!value) return null;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
};
export const dateTimeValue = (value) => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return dateOnlyValue(value);
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

export function getCalcTotalValue(license) {
  const quantity = finiteNumber(license.quantity);
  const unitPrice = finiteNumber(license.unitPrice);
  return quantity === null || unitPrice === null ? null : quantity * unitPrice;
}

function customFieldDefinition(colKey, customFieldDefs = []) {
  if (!colKey?.startsWith("cf_")) return null;
  const fieldKey = colKey.slice(3).replace(/^cf_/, "");
  return customFieldDefs.find((def) => String(def.fieldKey ?? def.field_key ?? "").replace(/^cf_/, "") === fieldKey) ?? null;
}

function customFieldSortValue(license, def, customFieldValuesMap) {
  const value = (customFieldValuesMap?.get(license.id) ?? []).find((entry) => entry.customFieldDefId === def?.id);
  if (!value) return null;
  const fieldType = def.fieldType ?? def.field_type;
  if (fieldType === "currency" || fieldType === "number") return finiteNumber(value.valueCurrency ?? value.valueText);
  if (fieldType === "date") return dateOnlyValue(value.valueText);
  if (fieldType === "boolean") {
    if (value.valueText === true || value.valueText === "true") return "True";
    if (value.valueText === false || value.valueText === "false") return "False";
    return null;
  }
  return value.valueText ?? null;
}

// Order expiration by visible urgency/lifecycle state, then by its date/days tie-breaker.
const EXPIRATION_ORDER = { expired: 0, expiring: 1, upcoming: 2, active: 3, perpetual: 4, pending_renewal: 5, renewed: 6, retired: 7, legacy: 8 };
function expirationSortValue(license) {
  const expiration = license.expiration ?? {};
  const status = expiration.status ?? license.expirationStatus;
  if (!status) return null;
  const rank = EXPIRATION_ORDER[status] ?? 9;
  let tie;
  if (status === "expired" || status === "expiring") tie = finiteNumber(expiration.days ?? license.daysUntilExpiry);
  else if (status === "upcoming") tie = dateOnlyValue(license.startDate);
  else tie = dateOnlyValue(license.endDate ?? license.startDate);
  return `${String(rank).padStart(2, "0")}|${tie === null ? "9999999999999" : String(tie).padStart(13, "0")}`;
}

const STATIC_SORT_ACCESSORS = {
  recordId: (license) => finiteNumber(license.id),
  licenseRef: (license) => license.licenseRef ?? null,
  externalRef: (license) => license.externalRef ?? null,
  publisher: (license) => license.publisherName ?? null,
  description: (license) => license.softwareDescription ?? null,
  contractNumber: (license) => license.contractNumber ?? null,
  poNumber: (license) => license.poNumber ?? null,
  procurementReference: (license) => license.procurementReference ?? null,
  invoiceNumber: (license) => license.invoiceNumber ?? license.invoiceNumbers?.[0] ?? null,
  costCentre: (license) => license.costCentre ?? null,
  supplier: (license) => license.supplier || "Direct",
  contactEmail: (license) => license.contactEmail ?? null,
  budgetOwnerEmail: (license) => license.budgetOwnerEmail ?? null,
  licenseType: (license) => labelFor(LICENSE_TYPES, license.licenseType),
  licenseMetric: (license) => labelFor(LICENSE_METRICS, license.licenseMetric),
  quantity: (license) => finiteNumber(license.quantity),
  effectiveQuantity: (license) => finiteNumber(license.effectiveQuantity),
  quantityPerUnit: (license) => finiteNumber(license.quantityPerUnit),
  skuCode: (license) => license.skuCode ?? null,
  unitPrice: (license) => finiteNumber(license.unitPrice),
  totalPoPrice: (license, { allLicenses }) => finiteNumber(getPoTotal(license.poNumber, allLicenses)),
  currency: (license) => license.currency ?? null,
  startDate: (license) => dateOnlyValue(license.startDate),
  endDate: (license) => dateOnlyValue(license.endDate),
  noticeDate: (license) => dateOnlyValue(license.noticeDate),
  requestDate: (license) => dateOnlyValue(license.requestDate),
  purchaseDate: (license) => dateOnlyValue(license.purchaseDate),
  portalUrl: (license) => license.portalUrl ?? null,
  notes: (license) => license.notes ?? null,
  docs: (license) => finiteNumber(license.documentCount ?? 0),
  calcTotal: (license) => getCalcTotalValue(license),
  expiration: (license) => expirationSortValue(license),
  complete: (license) => finiteNumber(license.completeness?.percentage),
  createdBy: (license) => license.createdByName || license.createdByEmail || (license.createdBy ? `User #${license.createdBy}` : "Unknown / legacy record"),
  createdAt: (license) => dateTimeValue(license.createdAt),
  updatedAt: (license) => dateTimeValue(license.updatedAt),
  lifecycleStatus: (license) => license.lifecycleStatus ?? null,
  syncStatus: (license) => license.syncStatus ?? null,
  lastSyncedAt: (license) => dateTimeValue(license.lastSyncedAt),
  maintenanceCoverage: (license) => labelFor(MAINTENANCE_COVERAGE_OPTIONS, license.maintenanceCoverage),
  maintenanceStartDate: (license) => dateOnlyValue(license.maintenanceStartDate),
  maintenanceEndDate: (license) => dateOnlyValue(license.maintenanceEndDate),
  maintenanceCost: (license) => finiteNumber(license.maintenanceCost),
};

export function getSortValue(license, colKey, context = {}) {
  const { allLicenses = [], customFieldValuesMap, customFieldDefs = [] } = context;
  const customDef = customFieldDefinition(colKey, customFieldDefs);
  if (customDef) return customFieldSortValue(license, customDef, customFieldValuesMap);
  const accessor = STATIC_SORT_ACCESSORS[colKey];
  return accessor ? accessor(license, { ...context, allLicenses }) : null;
}

export function hasSortAccessor(column) {
  if (!column || column.key === "select") return false;
  if (column._cfDef) return Boolean(column._cfDef.id && (column._cfDef.fieldKey || column._cfDef.field_key) && (column._cfDef.fieldType || column._cfDef.field_type));
  return Object.prototype.hasOwnProperty.call(STATIC_SORT_ACCESSORS, column.key);
}

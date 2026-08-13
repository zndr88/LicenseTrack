import { formatCustomFieldValue } from "../../../utils/customFieldPresentation.js";

export const LICENSE_COLUMN_GROUPS = [
  { key: "standard", label: "Standard" },
  { key: "advanced", label: "Advanced" },
  { key: "computed", label: "Computed" },
];

export const COLUMN_DEFS = [
  { key: "select", label: "", width: 36, defaultVisible: true, tableOnly: true },
  { key: "licenseRef", label: "LT Ref", settingsLabel: "License Reference", width: 125, group: "standard", defaultVisible: false, detailKey: "licenseRef" },
  { key: "externalRef", label: "External Ref", width: 130, group: "standard", defaultVisible: false },
  { key: "publisher", label: "Publisher", width: 140, group: "standard", defaultVisible: true },
  { key: "description", label: "Description", width: 240, group: "standard", defaultVisible: true },
  { key: "contractNumber", label: "Contract #", width: 130, group: "standard", defaultVisible: true },
  { key: "poNumber", label: "PO #", width: 130, group: "standard", defaultVisible: true },
  { key: "procurementReference", label: "Procurement Ref", width: 150, group: "standard", defaultVisible: false, detailKey: "procurementReference" },
  { key: "invoiceNumber", label: "Invoice #", width: 130, group: "standard", defaultVisible: false },
  { key: "costCentre", label: "Department", settingsLabel: "Cost Centre / Department", width: 120, group: "standard", defaultVisible: true, detailKey: "costCentre" },
  { key: "supplier", label: "Supplier", settingsLabel: "Supplier (third-party reseller)", width: 120, group: "standard", defaultVisible: true, detailKey: "supplier" },
  { key: "contactEmail", label: "Publisher Contact", width: 190, group: "standard", defaultVisible: false },
  { key: "budgetOwnerEmail", label: "Budget Owner", width: 190, group: "standard", defaultVisible: false },
  { key: "licenseType", label: "Type", settingsLabel: "License Type", width: 110, group: "standard", defaultVisible: true, detailKey: "licenseType" },
  { key: "licenseMetric", label: "Metric", settingsLabel: "License Metric", width: 110, group: "standard", defaultVisible: true, detailKey: "licenseMetric" },
  { key: "quantity", label: "Qty", settingsLabel: "Purchase Quantity", width: 70, group: "standard", defaultVisible: true, detailKey: "quantity" },
  { key: "effectiveQuantity", label: "Effective Qty", settingsLabel: "Effective Quantity", width: 110, group: "computed", defaultVisible: false, detailKey: "effectiveQuantity", computed: true },
  { key: "quantityPerUnit", label: "Qty / Unit", settingsLabel: "Quantity per Unit", width: 95, group: "standard", defaultVisible: false, detailKey: "quantityPerUnit" },
  { key: "skuCode", label: "SKU", settingsLabel: "SKU Code", width: 100, group: "standard", defaultVisible: false, detailKey: "skuCode" },
  { key: "unitPrice", label: "Unit Price", width: 110, group: "standard", defaultVisible: false, detailKey: "unitPrice" },
  { key: "totalPoPrice", label: "Total PO Value", width: 120, group: "computed", defaultVisible: true, detailKey: "totalPoPrice", computed: true },
  { key: "currency", label: "Currency", width: 85, group: "standard", defaultVisible: false },
  { key: "startDate", label: "Start Date", width: 100, group: "standard", defaultVisible: true, settingsKey: "dates", settingsLabel: "Dates", grouped: true },
  { key: "endDate", label: "End Date", width: 100, group: "standard", defaultVisible: true, settingsKey: "dates", grouped: true },
  { key: "noticeDate", label: "Notice Date", width: 110, group: "standard", defaultVisible: false },
  { key: "requestDate", label: "Request Date", width: 110, group: "standard", defaultVisible: false },
  { key: "purchaseDate", label: "Purchase Date", width: 110, group: "standard", defaultVisible: false },
  { key: "portalUrl", label: "Portal URL", width: 190, group: "standard", defaultVisible: false },
  { key: "notes", label: "Notes", settingsLabel: "Notes / Comments", width: 240, group: "standard", defaultVisible: false, detailKey: "notes", truncate: true },
  { key: "docs", label: "Docs", settingsLabel: "Procurement Documents", width: 80, group: "computed", defaultVisible: true, computed: true },
  { key: "calcTotal", label: "Calc. Total", width: 110, group: "computed", defaultVisible: false, computed: true },
  { key: "expiration", label: "Expiration", width: 140, group: "computed", defaultVisible: true, always: true, computed: true },
  { key: "complete", label: "Complete", width: 100, group: "computed", defaultVisible: true, always: true, computed: true },
  { key: "recordId", label: "License Record ID", width: 135, group: "advanced", defaultVisible: false },
  { key: "createdBy", label: "Created By", width: 150, group: "advanced", defaultVisible: false },
  { key: "createdAt", label: "Created", width: 145, group: "advanced", defaultVisible: false },
  { key: "updatedAt", label: "Last Updated", width: 145, group: "advanced", defaultVisible: false },
  { key: "lifecycleStatus", label: "Lifecycle Status", width: 130, group: "advanced", defaultVisible: false },
  { key: "syncStatus", label: "Sync Status", width: 110, group: "advanced", defaultVisible: false },
  { key: "lastSyncedAt", label: "Last Synced", width: 145, group: "advanced", defaultVisible: false },
  { key: "maintenanceCoverage", label: "Maintenance / Support Coverage", width: 190, group: "advanced", defaultVisible: false },
  { key: "maintenanceStartDate", label: "Maintenance Start", width: 135, group: "advanced", defaultVisible: false },
  { key: "maintenanceEndDate", label: "Maintenance End", width: 135, group: "advanced", defaultVisible: false },
  { key: "maintenanceCost", label: "Maintenance Cost", width: 135, group: "advanced", defaultVisible: false },
];

export const VISIBLE_IN_LIST_DEFAULTS = COLUMN_DEFS.reduce((defaults, column) => {
  if (!column.always) defaults[column.key] = column.defaultVisible ?? false;
  if (column.settingsKey) defaults[column.settingsKey] = column.defaultVisible ?? false;
  return defaults;
}, {});

export const SETTINGS_COLUMN_DEFS = COLUMN_DEFS.filter((column, index, columns) => (
  column.group
  && !column.always
  && (!column.settingsKey || columns.findIndex((item) => item.settingsKey === column.settingsKey) === index)
));

export function makeCustomFieldColumnDefs(customFieldDefs = []) {
  return customFieldDefs.map((def) => ({
    key: `cf_${def.fieldKey}`,
    label: def.name,
    width: 120,
    group: "custom",
    defaultVisible: false,
    _cfDef: def,
  }));
}

export function mergeVisibleColumns(visibleInList = {}) {
  return { ...VISIBLE_IN_LIST_DEFAULTS, ...visibleInList };
}

export function orderColumnDefs(columnDefs, columnOrder = []) {
  if (!columnOrder?.length) return columnDefs;
  const ordered = columnOrder
    .map((key) => columnDefs.find((column) => column.key === key))
    .filter(Boolean);
  const missing = columnDefs.filter((column) => !columnOrder.includes(column.key));
  return [...ordered, ...missing];
}

export function getFullExportColumns(columnDefs) {
  return columnDefs.filter((column) => !column.tableOnly);
}

export function formatBooleanCustomField(value) {
  return formatCustomFieldValue(value, { fieldType: "boolean" });
}

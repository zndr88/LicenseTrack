import { getPoTotal } from "../../../utils/helpers.js";
import { formatDate, formatDateTime } from "../../../utils/formatting.js";

// Maps export column key → importable snake_case field name.
// Columns absent from this map are computed/metadata — they keep their display label.
const IMPORTABLE_FIELD_NAMES = {
  licenseRef:       "license_ref",
  externalRef:      "external_ref",
  publisher:        "publisher_name",
  description:      "software_description",
  contractNumber:   "contract_number",
  poNumber:         "po_number",
  invoiceNumber:    "invoice_number",
  contactEmail:     "contact_email",
  supplier:         "supplier",
  costCentre:       "cost_centre",
  budgetOwnerEmail: "budget_owner_email",
  licenseType:      "license_type",
  licenseMetric:    "license_metric",
  quantity:         "quantity",
  skuCode:          "sku_code",
  unitPrice:        "unit_price",
  totalPoPrice:     "total_po_price",
  currency:         "currency",
  notes:            "notes",
  startDate:           "start_date",
  endDate:             "end_date",
  portalUrl:           "portal_url",
  maintenanceCoverage: "maintenance_coverage",
};

/**
 * Generate a CSV string from a filtered license array and the active visible columns.
 * Triggers a browser download as a side effect.
 *
 * Default (canonical) mode:
 *   - dates as ISO YYYY-MM-DD
 *   - decimals with "." separator
 *   - a "Currency" fixed column carries the ISO currency code for all money values
 *
 * Localized mode ({ localized: true, userSettings }):
 *   - dates formatted per user's dateFormat preference
 *   - numbers formatted per user's numberFormatLocale (locale decimal/group separators)
 *   - Currency column still present as ISO code
 *
 * @param {object[]} rows - The filtered license array (already sorted/filtered)
 * @param {object[]} columns - activeColumns filtered to visible only
 * @param {string} locale - numberFormatLocale from userSettings
 * @param {string} displayCurrency - fallback currency
 * @param {object[]} allLicenses - full unfiltered license array (needed for PO totals)
 * @param {Map} customFieldValuesMap
 * @param {{ localized?: boolean, userSettings?: object }} [options]
 */
export function exportFilteredCsv(rows, columns, locale, displayCurrency, allLicenses, customFieldValuesMap, { localized = false, userSettings = null } = {}) {
  const fmtDate = localized
    ? (val) => (val ? formatDate(val, userSettings) : "")
    : (val) => val ?? "";
  const fmtDateTime = localized
    ? (val) => (val ? formatDateTime(val, userSettings) : "")
    : (val) => val ?? "";

  const fmtDecimal = localized
    ? (val, fractionDigits = 2) => {
        const n = parseFloat(val);
        if (val == null || val === "" || isNaN(n)) return "";
        return new Intl.NumberFormat(userSettings?.numberFormatLocale ?? "en-US", {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }).format(n);
      }
    : (val) => val ?? "";

  const fmtQty = localized
    ? (val) => {
        const n = parseFloat(val);
        if (val == null || val === "" || isNaN(n)) return "";
        return new Intl.NumberFormat(userSettings?.numberFormatLocale ?? "en-US", {
          maximumFractionDigits: 4,
        }).format(n);
      }
    : (val) => val ?? "";

  const headers = columns.map((c) => IMPORTABLE_FIELD_NAMES[c.key] ?? c.label);

  const dataRows = rows.map((l) => {
    return columns.map((col) => {
      switch (col.key) {
        case "licenseRef": return l.licenseRef ?? "";
        case "externalRef": return l.externalRef ?? "";
        case "publisher": return l.publisherName ?? "";
        case "description": return l.softwareDescription ?? "";
        case "contractNumber": return l.contractNumber ?? "";
        case "poNumber": return l.poNumber ?? "";
        case "invoiceNumber": return l.invoiceNumber ?? "";
        case "costCentre": return l.costCentre ?? "";
        case "supplier": return l.supplier ?? "";
        case "contactEmail": return l.contactEmail ?? "";
        case "budgetOwnerEmail": return l.budgetOwnerEmail ?? "";
        case "licenseType": return l.licenseType ?? "";
        case "licenseMetric": return l.licenseMetric ?? "";
        case "quantity": return fmtQty(l.quantity);
        case "skuCode": return l.skuCode ?? "";
        case "unitPrice": return fmtDecimal(l.unitPrice);
        case "currency": return l.currency ?? "";
        case "totalPoPrice": {
          const total = getPoTotal(l.poNumber, allLicenses ?? rows);
          return fmtDecimal(total != null ? String(total) : "");
        }
        case "calcTotal": {
          const qty = Number(l.quantity);
          const unit = Number(l.unitPrice);
          if (!qty || !unit) return "";
          return fmtDecimal(String(qty * unit));
        }
        case "startDate": return fmtDate(l.startDate);
        case "endDate": return fmtDate(l.endDate);
        case "requestDate": return fmtDateTime(l.requestDate);
        case "purchaseDate": return fmtDateTime(l.purchaseDate);
        case "portalUrl": return l.portalUrl ?? "";
        case "notes": return l.notes ?? "";
        case "docs": return String(l.documentCount ?? 0);
        case "expiration": return l.expiration?.label ?? l.expiration?.status ?? "";
        case "complete": return l.completeness?.isExempt
          ? "Exempt"
          : l.completeness?.percentage != null
            ? `${l.completeness.percentage}%`
            : "";
        case "createdBy": return l.createdByName ?? l.createdByEmail ?? (l.createdBy ? `User #${l.createdBy}` : "Unknown / legacy record");
        case "createdAt": return fmtDateTime(l.createdAt);
        case "updatedAt": return fmtDateTime(l.updatedAt);
        case "lifecycleStatus": return l.lifecycleStatus ?? "";
        case "syncStatus": return l.syncStatus ?? "";
        case "lastSyncedAt": return fmtDateTime(l.lastSyncedAt);
        case "maintenanceCoverage": return l.maintenanceCoverage ?? "";
        case "maintenanceStartDate": return fmtDate(l.maintenanceStartDate);
        case "maintenanceEndDate": return fmtDate(l.maintenanceEndDate);
        case "maintenanceCost": return fmtDecimal(l.maintenanceCost);
        default: {
          if (col.key.startsWith("cf_") && col._cfDef) {
            const values = customFieldValuesMap?.get(l.id) ?? [];
            const val = values.find((v) => v.customFieldDefId === col._cfDef.id);
            if (!val) return "";
            if (col._cfDef.fieldType === "currency") return fmtDecimal(val.valueCurrency != null ? String(val.valueCurrency) : "");
            if (col._cfDef.fieldType === "date") return fmtDate(val.valueText);
            if (col._cfDef.fieldType === "boolean") return val.valueText ?? "";
            return val.valueText ?? "";
          }
          return "";
        }
      }
    });
  });

  const escape = (val) => {
    const raw = String(val ?? "");
    const s = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return (s.includes(",") || s.includes('"') || s.includes("\n"))
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const csvLines = [
    headers.map(escape).join(","),
    ...dataRows.map((row) => row.map(escape).join(",")),
  ];
  const csvContent = csvLines.join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "licenses_export.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

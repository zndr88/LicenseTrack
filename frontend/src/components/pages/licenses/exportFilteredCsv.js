import { getPoTotal } from "../../../utils/helpers.js";
import { formatDate, formatDateTime, toInputText } from "../../../utils/formatting.js";
import { formatQuantityInput } from "../../../utils/quantity.js";
import { getCalcTotalValue } from "../../../utils/sort.js";
import { renewableLabel } from "../../../utils/licenseTypeRules.js";
import csvFields from "../../../generated/csvFields.json";

const INVOICE_LIST_PREFIX = "LT-INVOICES:";

function serializeInvoiceCell(invoiceNumbers, invoiceNumber) {
  return invoiceNumbers?.length > 1
    ? `${INVOICE_LIST_PREFIX}${JSON.stringify(invoiceNumbers)}`
    : (invoiceNumber ?? "");
}

// Stable CSV headers come from the backend field registry (backend/app/services/csv_fields.py).
export const STABLE_EXPORT_FIELD_NAMES = csvFields.exportHeaders;

/**
 * Generate a CSV string from a filtered license array and the active visible columns.
 * Triggers a browser download as a side effect.
 *
 * Default (canonical) mode:
 * - dates as ISO YYYY-MM-DD
 * - decimals with "." separator
 * - a "Currency" fixed column carries the ISO currency code for all money values
 *
 * Localized mode ({ localized: true, userSettings }):
 * - dates formatted per user's dateFormat preference
 * - numbers formatted per user's numberFormatLocale (locale decimal/group separators)
 * - Currency column still present as ISO code
 *
 * @param {object[]} rows - The filtered license array (already sorted/filtered)
 * @param {object[]} columns - activeColumns filtered to visible only
 * @param {string} locale - numberFormatLocale from userSettings
 * @param {string} displayCurrency - fallback currency
 * @param {object[]} allLicenses - full unfiltered license array (needed for PO totals)
 * @param {Map} customFieldValuesMap
 * @param {{ localized?: boolean, userSettings?: object, stableCustomFieldHeaders?: boolean }} [options]
 */
export function exportFilteredCsv(rows, columns, locale, displayCurrency, allLicenses, customFieldValuesMap, { localized = false, userSettings = null, stableCustomFieldHeaders = false } = {}) {
  const fmtDate = localized
    ? (val) => (val ? formatDate(val, userSettings) : "")
    : (val) => val ?? "";
  const fmtDateTime = localized
    ? (val) => (val ? formatDateTime(val, userSettings) : "")
    : (val) => val ?? "";

  // Localized numbers use the same separators the importer reads
  // (toInputText), so a localized export imports back with the same format.
  const fmtDecimal = localized
    ? (val) => {
        const n = parseFloat(val);
        if (val == null || val === "" || isNaN(n)) return "";
        return toInputText(n.toFixed(2), userSettings, { minFractionDigits: 2 });
      }
    : (val) => val ?? "";

  const fmtQty = localized
    ? (val) => {
        if (val == null || val === "") return "";
        return formatQuantityInput(val, userSettings);
      }
    : (val) => val ?? "";

  const headers = columns.map((column) => {
    if (stableCustomFieldHeaders && column.key.startsWith("cf_") && column._cfDef?.fieldKey) {
      return column._cfDef.fieldKey;
    }
    return STABLE_EXPORT_FIELD_NAMES[column.key] ?? column.label;
  });

  const dataRows = rows.map((l) => {
    return columns.map((col) => {
      switch (col.key) {
        case "recordId": return l.id ?? "";
        case "licenseRef": return l.licenseRef ?? "";
        case "externalRef": return l.externalRef ?? "";
        case "publisher": return l.publisherName ?? "";
        case "description": return l.softwareDescription ?? "";
        case "contractNumber": return l.contractNumber ?? "";
        case "poNumber": return l.poNumber ?? "";
        case "poLineNumber": return l.poLineNumber ?? "";
        case "procurementReference": return l.procurementReference ?? "";
        case "invoiceNumber": return serializeInvoiceCell(l.invoiceNumbers, l.invoiceNumber);
        case "costCentre": return l.costCentre ?? "";
        case "supplier": return l.supplier ?? "";
        case "contactEmail": return l.contactEmail ?? "";
        case "budgetOwnerEmail": return l.budgetOwnerEmail ?? "";
        case "secondaryContacts": return l.secondaryContacts?.length ? l.secondaryContacts.join("; ") : "";
        case "licenseType": return l.licenseType ?? "";
        case "licenseMetric": return l.licenseMetric ?? "";
        case "quantity": return fmtQty(l.quantity);
        case "effectiveQuantity": return fmtQty(l.effectiveQuantity);
        case "quantityPerUnit": return fmtQty(l.quantityPerUnit);
        case "skuCode": return l.skuCode ?? "";
        case "unitPrice": return fmtDecimal(l.unitPrice);
        case "lineTotal": return fmtDecimal(l.totalPoPrice);
        case "poTotalOverride": return fmtDecimal(l.poTotalOverride);
        case "currency": return l.currency ?? "";
        case "totalPoPrice": {
          const total = getPoTotal(l.poNumber, l.currency, allLicenses ?? rows, l);
          return fmtDecimal(total != null ? String(total) : "");
        }
        case "calcTotal": {
          const total = getCalcTotalValue(l);
          return total === null ? "" : fmtDecimal(String(total));
        }
        case "startDate": return fmtDate(l.startDate);
        case "endDate": return fmtDate(l.endDate);
        case "noticeDate": return fmtDate(l.noticeDate);
        case "requestDate": return fmtDateTime(l.requestDate);
        case "purchaseDate": return fmtDateTime(l.purchaseDate);
        case "portalUrl": return l.portalUrl ?? "";
        case "isRenewable": return renewableLabel(l);
        case "typeDescription": return l.typeDescription ?? "";
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
        case "parentLicenseRefs": {
          if (l.licenseType !== "maintenance") return "";
          const parentIds = new Set(l.maintenanceParentIds ?? []);
          return (allLicenses ?? rows)
            .filter((candidate) => parentIds.has(candidate.id))
            .map((candidate) => candidate.licenseRef)
            .filter(Boolean)
            .join("; ");
        }
        case "maintenancePricingBasis": return l.maintenancePricingBasis ?? "";
        case "maintenanceQuantity": return fmtQty(l.maintenanceQuantity);
        case "maintenanceUnitPrice": return fmtDecimal(l.maintenanceUnitPrice);
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
  const csvContent = `\ufeff${csvLines.join("\r\n")}`;

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

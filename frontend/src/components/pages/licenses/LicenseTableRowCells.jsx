import { useEffect, useState } from "react";
import { LICENSE_TYPES, LICENSE_METRICS, MAINTENANCE_COVERAGE_OPTIONS } from "../../../constants/licenseData.js";
import { formatCost, getPoTotal } from "../../../utils/helpers.js";
import Badge from "../../ui/Badge.jsx";
import { formatBooleanCustomField } from "./licenseColumns.js";
import { parseLocalizedNumber, formatDate, formatDateTime } from "../../../utils/formatting.js";

const INLINE_EDIT_CONFIG = {
  publisher: { fieldKey: "publisherName", inputType: "text", className: "pub-cell" },
  description: { fieldKey: "softwareDescription", inputType: "text", className: "lp-td", style: { maxWidth: 240 } },
  contractNumber: { fieldKey: "contractNumber", inputType: "text", className: "mono" },
  poNumber: { fieldKey: "poNumber", inputType: "text", className: "mono" },
  procurementReference: { fieldKey: "procurementReference", inputType: "text", className: "mono" },
  costCentre: { fieldKey: "costCentre", inputType: "text", className: "lp-td" },
  supplier: { fieldKey: "supplier", inputType: "text", className: "lp-td" },
  licenseType: { fieldKey: "licenseType", inputType: "select", className: "lp-td", options: LICENSE_TYPES },
  licenseMetric: { fieldKey: "licenseMetric", inputType: "select", className: "lp-td", options: LICENSE_METRICS },
  quantity: { fieldKey: "quantity", inputType: "text", inputMode: "decimal", className: "mono td-center" },
  quantityPerUnit: { fieldKey: "quantityPerUnit", inputType: "text", inputMode: "decimal", className: "mono td-center" },
  skuCode: { fieldKey: "skuCode", inputType: "text", className: "mono lp-sku" },
  unitPrice: { fieldKey: "unitPrice", inputType: "text", className: "mono lp-mono-bold" },
  startDate: { fieldKey: "startDate", inputType: "date", className: "mono", style: { width: 100 } },
  endDate: { fieldKey: "endDate", inputType: "date", className: "mono", style: { width: 100 } },
  noticeDate: { fieldKey: "noticeDate", inputType: "date", className: "mono", style: { width: 110 } },
};

function normalizeInlineValue(fieldKey, value, userSettings) {
  if (fieldKey === "quantity" || fieldKey === "quantityPerUnit" || fieldKey === "unitPrice") {
    return parseLocalizedNumber(value, userSettings) ?? String(value ?? "");
  }
  return value ?? "";
}

function formatQuantityCell(value, userSettings) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "-";
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(quantity);
  } catch {
    return String(value);
  }
}

function InlineEditableCell({ license, col, config, currentValue, onInlineFieldSave, userSettings }) {
  const [value, setValue] = useState(currentValue ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!saving) setValue(currentValue ?? "");
  }, [currentValue, saving]);

  const commit = async () => {
    if (saving) return;
    const nextValue = normalizeInlineValue(config.fieldKey, value, userSettings);
    const previousValue = currentValue ?? "";
    if (String(nextValue) === String(previousValue)) {
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    const result = await onInlineFieldSave?.(license.id, config.fieldKey, nextValue);
    setSaving(false);
    if (!result?.ok) {
      setError(result?.error || "Save failed");
      setValue(previousValue);
    }
  };

  const handleKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setValue(currentValue ?? "");
      setError(null);
      event.currentTarget.blur();
    }
  };

  const commonProps = {
    className: `lp-inline-input ${error ? "lp-inline-input-error" : ""}`,
    value,
    disabled: saving,
    "aria-label": `Edit ${col.label || config.fieldKey}`,
    onClick: (event) => event.stopPropagation(),
    onChange: (event) => setValue(event.target.value),
    onKeyDown: handleKeyDown,
    onBlur: commit,
  };

  return (
    <td key={col.key} className={`${config.className ?? "lp-td"} lp-editable-td`} style={config.style}>
      <div className="lp-inline-edit-wrap">
        {config.inputType === "select" ? (
          <select {...commonProps} className={`${commonProps.className} fi-select`}>
            <option value="">-</option>
            {(config.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : (
          <input {...commonProps} type={config.inputType} inputMode={config.inputMode} />
        )}
        {saving && <span className="lp-inline-save-dot" aria-label="Saving" />}
        {error && <span className="lp-inline-error" title={error}>!</span>}
      </div>
    </td>
  );
}

function ExpirationCell({ license }) {
  return (
    <>
      {license.expiration.status === "retired" && <Badge type="gray">Retired</Badge>}
      {license.expiration.status === "legacy" && <Badge type="gray">Legacy</Badge>}
      {license.expiration.status === "renewed" && <span className="badge badge-renewed"><span className="badge-dot" />Renewed</span>}
      {license.expiration.status === "pending_renewal" && <span className="badge badge-pending"><span className="badge-dot" />Pending Renewal</span>}
      {license.expiration.status === "upcoming" && <Badge type="blue">{license.expiration.label}</Badge>}
      {license.expiration.status === "expired" && <Badge type="red">{license.expiration.label}</Badge>}
      {license.expiration.status === "expiring" && <Badge type="orange">{license.expiration.label}</Badge>}
      {license.expiration.status === "active" && <Badge type="green">{license.expiration.label}</Badge>}
      {license.expiration.status === "perpetual" && <Badge type="blue">Perpetual</Badge>}
    </>
  );
}

function StatusCell({ license }) {
  if (license.completeness.isExempt || license.completeness.percentage == null) {
    return <span className="lp-date-sub">Exempt</span>;
  }

  return (
    <div className="lp-comp-row">
      <div className="comp-bar"><div className="comp-fill" style={{ transform: `scaleX(${license.completeness.percentage / 100})`, background: license.completeness.isComplete ? "var(--green)" : "var(--orange)" }} /></div>
      <span className="lp-comp-pct" style={{ color: license.completeness.isComplete ? "var(--green)" : "var(--orange)" }}>{license.completeness.percentage}%</span>
    </div>
  );
}

function renderCustomFieldCell({ col, license, customFieldValuesMap, displayCurrency, locale, userSettings }) {
  const values = customFieldValuesMap.get(license.id) ?? [];
  const value = values.find((entry) => entry.customFieldDefId === col._cfDef.id);
  if (!value) return <td key={col.key} className="lp-td">-</td>;

  if (col._cfDef.fieldType === "currency") {
    return (
      <td key={col.key} className="mono lp-mono-bold">
        {formatCost(value.valueCurrency, license.currency || displayCurrency, locale)}
      </td>
    );
  }

  if (col._cfDef.fieldType === "date") {
    return (
      <td key={col.key} className="mono">
        {value.valueText ? (formatDate(value.valueText, userSettings) || value.valueText) : "-"}
      </td>
    );
  }

  if (col._cfDef.fieldType === "boolean") {
    return <td key={col.key} className="lp-td">{formatBooleanCustomField(value.valueText) ?? "-"}</td>;
  }

  return <td key={col.key} className="lp-td">{value.valueText || "-"}</td>;
}

function InvoiceNumberCell({ license }) {
  const invoiceNumbers = Array.isArray(license.invoiceNumbers)
    ? license.invoiceNumbers.filter(Boolean)
    : (license.invoiceNumber ? [license.invoiceNumber] : []);
  const primary = license.invoiceNumber || invoiceNumbers[0] || "";

  return (
    <td key="invoiceNumber" className="mono">
      {primary || "-"}
      {invoiceNumbers.length > 1 && <span className="invoice-count-badge">+{invoiceNumbers.length - 1}</span>}
    </td>
  );
}

export default function LicenseTableRowCells({
  license,
  visibleColumns,
  selectedIds,
  setSelectedIds,
  licenses,
  customFieldValuesMap,
  displayCurrency,
  userSettings,
  inlineEditEnabled,
  onInlineFieldSave,
}) {
  const locale = userSettings.numberFormatLocale ?? "en-US";

  return visibleColumns.map((col) => {
    const inlineConfig = inlineEditEnabled ? INLINE_EDIT_CONFIG[col.key] : null;
    if (inlineConfig) {
      return (
        <InlineEditableCell
          key={col.key}
          license={license}
          col={col}
          config={inlineConfig}
          currentValue={license[inlineConfig.fieldKey] ?? ""}
          onInlineFieldSave={onInlineFieldSave}
          userSettings={userSettings}
        />
      );
    }

    switch (col.key) {
      case "select":
        return (
          <td key="select" style={{ width: 36, padding: "0 8px", textAlign: "center", verticalAlign: "middle" }}>
            <input
              type="checkbox"
              checked={selectedIds.has(license.id)}
              onChange={() => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  next.has(license.id) ? next.delete(license.id) : next.add(license.id);
                  return next;
                });
              }}
              aria-label={`Select ${license.softwareDescription}`}
              onClick={(e) => e.stopPropagation()}
            />
          </td>
        );
      case "publisher":
        return <td key="publisher" className="pub-cell">{license.publisherName}</td>;
      case "recordId":
        return <td key="recordId" className="mono">{license.id}</td>;
      case "licenseRef":
        return <td key="licenseRef" className="mono">{license.licenseRef || "-"}</td>;
      case "externalRef":
        return <td key="externalRef" className="mono">{license.externalRef || "-"}</td>;
      case "description":
        return <td key="description" className="lp-td" style={{ maxWidth: 240 }}>{license.softwareDescription}</td>;
      case "contractNumber":
        return <td key="contractNumber" className="mono">{license.contractNumber || "-"}</td>;
      case "poNumber":
        return <td key="poNumber" className="mono">{license.poNumber || "-"}</td>;
      case "procurementReference":
        return <td key="procurementReference" className="mono">{license.procurementReference || "-"}</td>;
      case "invoiceNumber":
        return <InvoiceNumberCell key="invoiceNumber" license={license} />;
      case "costCentre":
        return <td key="costCentre" className="lp-td">{license.costCentre || "-"}</td>;
      case "supplier":
        return <td key="supplier" className="lp-td">{license.supplier || "Direct"}</td>;
      case "contactEmail":
        return <td key="contactEmail" className="lp-td">{license.contactEmail || "-"}</td>;
      case "budgetOwnerEmail":
        return <td key="budgetOwnerEmail" className="lp-td">{license.budgetOwnerEmail || "-"}</td>;
      case "licenseType":
        return <td key="licenseType" className="lp-td">{license.licenseType ? (LICENSE_TYPES.find((type) => type.value === license.licenseType)?.label || license.licenseType) : "-"}</td>;
      case "licenseMetric":
        return <td key="licenseMetric" className="lp-td">{license.licenseMetric ? (LICENSE_METRICS.find((metric) => metric.value === license.licenseMetric)?.label || license.licenseMetric) : "-"}</td>;
      case "quantity": {
        return <td key="quantity" className="mono td-center">{formatQuantityCell(license.quantity, userSettings)}</td>;
      }
      case "effectiveQuantity": {
        return <td key="effectiveQuantity" className="mono td-center">{formatQuantityCell(license.effectiveQuantity, userSettings)}</td>;
      }
      case "quantityPerUnit": {
        return <td key="quantityPerUnit" className="mono td-center">{formatQuantityCell(license.quantityPerUnit, userSettings)}</td>;
      }
      case "skuCode":
        return <td key="skuCode" className="mono lp-sku">{license.skuCode || "-"}</td>;
      case "unitPrice":
        return <td key="unitPrice" className="mono lp-mono-bold">{formatCost(license.unitPrice, license.currency || displayCurrency, locale)}</td>;
      case "currency":
        return <td key="currency" className="mono">{license.currency || "-"}</td>;
      case "totalPoPrice":
        return <td key="totalPoPrice" className="mono lp-mono-bold">{formatCost(getPoTotal(license.poNumber, licenses), license.currency || displayCurrency, locale)}</td>;
      case "calcTotal": {
        const qty = Number(license.quantity);
        const unit = Number(license.unitPrice);
        if (!qty || !unit) return <td key="calcTotal" className="mono lp-mono-bold">-</td>;
        return <td key="calcTotal" className="mono lp-mono-bold">{formatCost(qty * unit, license.currency || displayCurrency, locale)}</td>;
      }
      case "startDate":
        return <td key="startDate" className="mono" style={{ width: 100 }}>{license.startDate ? formatDate(license.startDate, userSettings) : "-"}</td>;
      case "endDate":
        return <td key="endDate" className="mono" style={{ width: 100 }}>{license.endDate ? formatDate(license.endDate, userSettings) : "-"}</td>;
      case "noticeDate":
        return <td key="noticeDate" className="mono" style={{ width: 110 }}>{license.noticeDate ? formatDate(license.noticeDate, userSettings) : "-"}</td>;
      case "requestDate":
        return <td key="requestDate" className="mono">{license.requestDate ? formatDate(license.requestDate, userSettings) : "-"}</td>;
      case "purchaseDate":
        return <td key="purchaseDate" className="mono">{license.purchaseDate ? formatDate(license.purchaseDate, userSettings) : "-"}</td>;
      case "portalUrl":
        return <td key="portalUrl" className="lp-td">{license.portalUrl || "-"}</td>;
      case "notes":
        return (
          <td key="notes" className="lp-td" title={license.notes || ""}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{license.notes || "-"}</div>
          </td>
        );
      case "docs": {
        const totalDocuments = license.documentCount ?? 0;
        const missingDocuments = (license.missingDocumentCount ?? 0) + (license.unavailableDocumentCount ?? 0);
        const documentLabel = `${totalDocuments}${missingDocuments ? "*" : ""}`;
        return (
          <td key="docs" className="td-center">
            <span
              className="mono"
              title={missingDocuments ? `${missingDocuments} document file(s) missing or unavailable` : `${totalDocuments} document record(s)`}
              style={{ fontSize: 11, color: missingDocuments ? "var(--orange-text)" : totalDocuments ? "var(--text-2)" : "var(--text-3)" }}
            >
              {documentLabel}
            </span>
          </td>
        );
      }
      case "expiration":
        return <td key="expiration"><ExpirationCell license={license} /></td>;
      case "complete":
        return <td key="complete"><StatusCell license={license} /></td>;
      case "createdBy":
        return <td key="createdBy" className="lp-td">{license.createdByName || license.createdByEmail || (license.createdBy ? `User #${license.createdBy}` : "Unknown / legacy record")}</td>;
      case "createdAt":
        return <td key="createdAt" className="mono">{license.createdAt ? formatDate(license.createdAt, userSettings) : "-"}</td>;
      case "updatedAt":
        return <td key="updatedAt" className="mono">{license.updatedAt ? formatDateTime(license.updatedAt, userSettings) : "-"}</td>;
      case "lifecycleStatus":
        return <td key="lifecycleStatus" className="lp-td">{license.lifecycleStatus || "-"}</td>;
      case "syncStatus":
        return <td key="syncStatus" className="lp-td">{license.syncStatus || "-"}</td>;
      case "lastSyncedAt":
        return <td key="lastSyncedAt" className="mono">{license.lastSyncedAt ? formatDateTime(license.lastSyncedAt, userSettings) : "-"}</td>;
      case "maintenanceCoverage":
        return <td key="maintenanceCoverage" className="lp-td">{MAINTENANCE_COVERAGE_OPTIONS.find((option) => option.value === license.maintenanceCoverage)?.label || license.maintenanceCoverage || "-"}</td>;
      case "maintenanceStartDate":
        return <td key="maintenanceStartDate" className="mono">{license.maintenanceStartDate ? formatDate(license.maintenanceStartDate, userSettings) : "-"}</td>;
      case "maintenanceEndDate":
        return <td key="maintenanceEndDate" className="mono">{license.maintenanceEndDate ? formatDate(license.maintenanceEndDate, userSettings) : "-"}</td>;
      case "maintenanceCost":
        return <td key="maintenanceCost" className="mono lp-mono-bold">{formatCost(license.maintenanceCost, license.currency || displayCurrency, locale)}</td>;
      default:
        if (col.key.startsWith("cf_") && col._cfDef) {
          return renderCustomFieldCell({ col, license, customFieldValuesMap, displayCurrency, locale, userSettings });
        }
        return <td key={col.key} />;
    }
  });
}

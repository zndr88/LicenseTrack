import { formatPriceInput } from "../../../utils/helpers.js";
import { parseLocalizedNumber } from "../../../utils/formatting.js";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES, MAINTENANCE_COVERAGE_OPTIONS } from "../../../constants/licenseData.js";
import Icon from "../../ui/Icon.jsx";

/**
 * Full-panel edit form shown when editingLicense is true.
 * All fields map 1-to-1 onto the editFields state slice.
 */
export default function LicenseEditForm({
  editFields,
  setEditFields,
  editError,
  savingLicense,
  displayUnitPrice,
  setDisplayUnitPrice,
  userSettings,
  onSave,
  onCancel,
}) {
  const noticeAfterEnd = Boolean(editFields.noticeDate && editFields.endDate && editFields.noticeDate > editFields.endDate);

  return (
    <div className="dp-edit-form">
      <div className="dp-edit-title">Edit License Details</div>
      {editError && (
        <div style={{ color: "var(--red-text)", fontSize: 11, marginBottom: 8 }}>
          {editError}
        </div>
      )}
      <div className="fg">
        <label htmlFor="license-edit-publisher">Publisher Name</label>
        <input id="license-edit-publisher" className="fi" value={editFields.publisherName} onChange={(e) => setEditFields((p) => ({ ...p, publisherName: e.target.value }))} />
      </div>
      <div className="fg">
        <label htmlFor="license-edit-software">Software Description</label>
        <input id="license-edit-software" className="fi" value={editFields.softwareDescription} onChange={(e) => setEditFields((p) => ({ ...p, softwareDescription: e.target.value }))} />
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-start-date">Start Date</label>
          <input id="license-edit-start-date" className="fi" type="date" value={editFields.startDate} onChange={(e) => setEditFields((p) => ({ ...p, startDate: e.target.value }))} />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-end-date">End Date</label>
          <input id="license-edit-end-date" className="fi" type={editFields.endDate === "Perpetual" ? "text" : "date"} value={editFields.endDate} onChange={(e) => setEditFields((p) => ({ ...p, endDate: e.target.value }))} />
        </div>
      </div>
      <div className="fg">
        <label htmlFor="license-edit-notice-date">Notice Date</label>
        <input id="license-edit-notice-date" className="fi" type="date" value={editFields.noticeDate || ""} onChange={(e) => setEditFields((p) => ({ ...p, noticeDate: e.target.value }))} />
        {noticeAfterEnd && <div className="dp-field-warning">Notice date is after the license end date.</div>}
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-contract">Contract #</label>
          <input id="license-edit-contract" className="fi" value={editFields.contractNumber} onChange={(e) => setEditFields((p) => ({ ...p, contractNumber: e.target.value }))} />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-po">PO #</label>
          <input id="license-edit-po" className="fi" value={editFields.poNumber} onChange={(e) => setEditFields((p) => ({ ...p, poNumber: e.target.value }))} />
        </div>
      </div>
      <div className="fg">
        <label htmlFor="license-edit-invoice">Invoice #</label>
        <input id="license-edit-invoice" className="fi" value={editFields.invoiceNumber} onChange={(e) => setEditFields((p) => ({ ...p, invoiceNumber: e.target.value }))} />
      </div>
      <div className="fg">
        <label htmlFor="license-edit-contact">Publisher Contact Email</label>
        <input id="license-edit-contact" className="fi" type="email" value={editFields.contactEmail} onChange={(e) => setEditFields((p) => ({ ...p, contactEmail: e.target.value }))} />
      </div>
      <div className="fg">
        <label htmlFor="license-edit-budget-owner">Budget Owner Email</label>
        <input id="license-edit-budget-owner" className="fi" type="email" value={editFields.budgetOwnerEmail || ""} onChange={(e) => setEditFields((p) => ({ ...p, budgetOwnerEmail: e.target.value }))} placeholder="owner@example.com" />
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-supplier">Supplier</label>
          <input id="license-edit-supplier" className="fi" value={editFields.supplier} onChange={(e) => setEditFields((p) => ({ ...p, supplier: e.target.value }))} />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-cost-centre">Cost Centre / Dept</label>
          <input id="license-edit-cost-centre" className="fi" value={editFields.costCentre} onChange={(e) => setEditFields((p) => ({ ...p, costCentre: e.target.value }))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-type">License Type</label>
          <select id="license-edit-type" className="fi fi-select" value={editFields.licenseType} onChange={(e) => {
            const t = e.target.value;
            setEditFields((p) => ({ ...p, licenseType: t, ...(t !== "saas" ? { portalUrl: "" } : {}) }));
          }}>
            <option value="">—</option>
            {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="fg">
          <label htmlFor="license-edit-metric">License Metric</label>
          <select id="license-edit-metric" className="fi fi-select" value={editFields.licenseMetric} onChange={(e) => setEditFields((p) => ({ ...p, licenseMetric: e.target.value }))}>
            <option value="">—</option>
            {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {editFields.licenseType === "saas" && (
        <div className="fg">
          <label htmlFor="license-edit-portal-url">Portal URL</label>
          <input id="license-edit-portal-url" className="fi" value={editFields.portalUrl || ""} onChange={(e) => setEditFields((p) => ({ ...p, portalUrl: e.target.value }))} placeholder="https://..." />
        </div>
      )}
      {["perpetual", "oem", "freeware"].includes(editFields.licenseType) && (
        <div className="fg">
          <label htmlFor="license-edit-maintenance-coverage">Maintenance / Support Coverage</label>
          <select id="license-edit-maintenance-coverage" className="fi fi-select" value={editFields.maintenanceCoverage || "unknown"} onChange={(e) => setEditFields((p) => ({ ...p, maintenanceCoverage: e.target.value }))}>
            {MAINTENANCE_COVERAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )}
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-quantity">Purchase Quantity</label>
          <input id="license-edit-quantity" className="fi" inputMode="decimal" value={editFields.quantity} onChange={(e) => setEditFields((p) => ({ ...p, quantity: parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value }))} />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-sku">SKU Code</label>
          <input id="license-edit-sku" className="fi" value={editFields.skuCode} onChange={(e) => setEditFields((p) => ({ ...p, skuCode: e.target.value }))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-unit-price">Unit Price</label>
          <input
            id="license-edit-unit-price"
            className="fi"
            value={displayUnitPrice}
            onFocus={() => setDisplayUnitPrice(editFields.unitPrice)}
            onChange={(e) => {
              setDisplayUnitPrice(e.target.value);
              setEditFields((p) => ({ ...p, unitPrice: parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value }));
            }}
            onBlur={() =>
              setDisplayUnitPrice(
                formatPriceInput(editFields.unitPrice, userSettings?.numberFormatLocale ?? "en-US")
              )
            }
          />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-currency">Currency</label>
          <select id="license-edit-currency" className="fi fi-select" value={editFields.currency} onChange={(e) => setEditFields((p) => ({ ...p, currency: e.target.value }))}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="dp-btn-row">
        <button className="btn btn-g btn-sm" disabled={savingLicense} onClick={onCancel}>Cancel</button>
        <button className="btn btn-p btn-sm" disabled={savingLicense} onClick={onSave}>
          <Icon name="check" size={12} /> {savingLicense ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

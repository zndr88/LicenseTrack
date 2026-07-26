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
        <label>Publisher Name</label>
        <input className="fi" value={editFields.publisherName} onChange={(e) => setEditFields((p) => ({ ...p, publisherName: e.target.value }))} />
      </div>
      <div className="fg">
        <label>Software Description</label>
        <input className="fi" value={editFields.softwareDescription} onChange={(e) => setEditFields((p) => ({ ...p, softwareDescription: e.target.value }))} />
      </div>
      <div className="fr">
        <div className="fg">
          <label>Start Date</label>
          <input className="fi" type="date" value={editFields.startDate} onChange={(e) => setEditFields((p) => ({ ...p, startDate: e.target.value }))} />
        </div>
        <div className="fg">
          <label>End Date</label>
          <input className="fi" type={editFields.endDate === "Perpetual" ? "text" : "date"} value={editFields.endDate} onChange={(e) => setEditFields((p) => ({ ...p, endDate: e.target.value }))} />
        </div>
      </div>
      <div className="fg">
        <label>Notice Date</label>
        <input className="fi" type="date" value={editFields.noticeDate || ""} onChange={(e) => setEditFields((p) => ({ ...p, noticeDate: e.target.value }))} />
        {noticeAfterEnd && <div className="dp-field-warning">Notice date is after the license end date.</div>}
      </div>
      <div className="fr">
        <div className="fg">
          <label>Contract #</label>
          <input className="fi" value={editFields.contractNumber} onChange={(e) => setEditFields((p) => ({ ...p, contractNumber: e.target.value }))} />
        </div>
        <div className="fg">
          <label>PO #</label>
          <input className="fi" value={editFields.poNumber} onChange={(e) => setEditFields((p) => ({ ...p, poNumber: e.target.value }))} />
        </div>
      </div>
      <div className="fg">
        <label>Invoice #</label>
        <input className="fi" value={editFields.invoiceNumber} onChange={(e) => setEditFields((p) => ({ ...p, invoiceNumber: e.target.value }))} />
      </div>
      <div className="fg">
        <label>Publisher Contact Email</label>
        <input className="fi" type="email" value={editFields.contactEmail} onChange={(e) => setEditFields((p) => ({ ...p, contactEmail: e.target.value }))} />
      </div>
      <div className="fg">
        <label>Budget Owner Email</label>
        <input className="fi" type="email" value={editFields.budgetOwnerEmail || ""} onChange={(e) => setEditFields((p) => ({ ...p, budgetOwnerEmail: e.target.value }))} placeholder="owner@example.com" />
      </div>
      <div className="fr">
        <div className="fg">
          <label>Supplier</label>
          <input className="fi" value={editFields.supplier} onChange={(e) => setEditFields((p) => ({ ...p, supplier: e.target.value }))} />
        </div>
        <div className="fg">
          <label>Cost Centre / Dept</label>
          <input className="fi" value={editFields.costCentre} onChange={(e) => setEditFields((p) => ({ ...p, costCentre: e.target.value }))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label>License Type</label>
          <select className="fi fi-select" value={editFields.licenseType} onChange={(e) => {
            const t = e.target.value;
            setEditFields((p) => ({ ...p, licenseType: t, ...(t !== "saas" ? { portalUrl: "" } : {}) }));
          }}>
            <option value="">—</option>
            {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="fg">
          <label>License Metric</label>
          <select className="fi fi-select" value={editFields.licenseMetric} onChange={(e) => setEditFields((p) => ({ ...p, licenseMetric: e.target.value }))}>
            <option value="">—</option>
            {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {editFields.licenseType === "saas" && (
        <div className="fg">
          <label htmlFor="portal-url">Portal URL</label>
          <input id="portal-url" className="fi" value={editFields.portalUrl || ""} onChange={(e) => setEditFields((p) => ({ ...p, portalUrl: e.target.value }))} placeholder="https://..." />
        </div>
      )}
      {["perpetual", "oem", "freeware"].includes(editFields.licenseType) && (
        <div className="fg">
          <label>Maintenance / Support Coverage</label>
          <select className="fi fi-select" value={editFields.maintenanceCoverage || "unknown"} onChange={(e) => setEditFields((p) => ({ ...p, maintenanceCoverage: e.target.value }))}>
            {MAINTENANCE_COVERAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )}
      <div className="fr">
        <div className="fg">
          <label>Purchase Quantity</label>
          <input className="fi" inputMode="decimal" value={editFields.quantity} onChange={(e) => setEditFields((p) => ({ ...p, quantity: parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value }))} />
        </div>
        <div className="fg">
          <label>SKU Code</label>
          <input className="fi" value={editFields.skuCode} onChange={(e) => setEditFields((p) => ({ ...p, skuCode: e.target.value }))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label>Unit Price</label>
          <input
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
          <label>Currency</label>
          <select className="fi fi-select" value={editFields.currency} onChange={(e) => setEditFields((p) => ({ ...p, currency: e.target.value }))}>
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

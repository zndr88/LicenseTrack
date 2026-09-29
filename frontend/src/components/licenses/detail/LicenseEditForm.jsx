import { formatPriceInput } from "../../../utils/helpers.js";
import { parseTypedNumber, formatDate } from "../../../utils/formatting.js";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES, SUPPLIER_CONTACT_HELP } from "../../../constants/licenseData.js";
import {
  defaultMaintenanceCoverageForLicenseType,
  isMaintenanceParentType,
  maintenanceCoverageOptionsForLicenseType,
  supportsMaintenanceCoverage,
  supportsSeparateMaintenanceLine,
} from "../../../utils/maintenanceCoverage.js";
import {
  isHiddenFromLinking,
  isLinkedToParent,
  maintenanceCandidate,
  parentCandidate,
} from "../../../utils/maintenanceLinking.js";
import { useAllLicenses } from "../../../hooks/useAllLicenses.js";
import LinkPicker from "../../ui/LinkPicker.jsx";
import Icon from "../../ui/Icon.jsx";
import ReferenceCombobox from "../../ui/ReferenceCombobox.jsx";
import ContactCombobox from "../../ui/ContactCombobox.jsx";
import CustomFieldFormFields from "../CustomFieldFormFields.jsx";
import LicenseTypeOptInFields from "../LicenseTypeOptInFields.jsx";
import { TYPE_DESCRIPTION_REQUIRED_MESSAGE, typeDescriptionMissing } from "../../../utils/licenseTypeRules.js";
import InvoiceNumberRows from "../InvoiceNumberRows.jsx";

/**
 * Full-panel edit form shown when editingLicense is true.
 * All fields map 1-to-1 onto the editFields state slice.
 */
export default function LicenseEditForm({
  editFields,
  currentLicenseType,
  licenseId,
  activeMaintenanceId,
  quickLinkMaintenanceId = "",
  setQuickLinkMaintenanceId,
  setEditFields,
  editError,
  savingLicense,
  displayUnitPrice,
  setDisplayUnitPrice,
  userSettings,
  customFieldDefs = [],
  customFieldsLoading = false,
  onSave,
  onCancel,
}) {
  const { licenses: allLicenses } = useAllLicenses();
  // Maintenance needs a parent, chosen below in the same save. A license that
  // already has active maintenance of its own can't become maintenance.
  const licenseTypeOptions = LICENSE_TYPES.map((option) => (
    option.value === "maintenance" && currentLicenseType !== "maintenance" && activeMaintenanceId
      ? { ...option, disabled: true }
      : option
  ));
  const switchingToMaintenance = editFields.licenseType === "maintenance" && currentLicenseType !== "maintenance";
  const parentCandidates = switchingToMaintenance
    ? allLicenses
      .filter((item) => isMaintenanceParentType(item.licenseType) && !isHiddenFromLinking(item) && item.id !== licenseId)
      .map(parentCandidate)
    : [];
  const showQuickLink = currentLicenseType !== "maintenance"
    && supportsSeparateMaintenanceLine(editFields.licenseType)
    && editFields.maintenanceCoverage === "separately_tracked";
  const quickLinkCandidates = showQuickLink
    ? allLicenses
      .filter((item) => item.licenseType === "maintenance" && !isHiddenFromLinking(item) && !isLinkedToParent(item, licenseId))
      .map((item) => maintenanceCandidate(item, allLicenses, { formatDay: (value) => formatDate(value, userSettings) }))
    : [];
  const descriptionMissing = typeDescriptionMissing(editFields.licenseType, editFields.typeDescription);
  const noticeAfterEnd = Boolean(editFields.noticeDate && editFields.endDate && editFields.noticeDate > editFields.endDate);
  const maintenanceCoverageOptions = maintenanceCoverageOptionsForLicenseType(editFields.licenseType);
  const maintenanceCoverageValue = maintenanceCoverageOptions.some(
    (option) => option.value === editFields.maintenanceCoverage
  )
    ? editFields.maintenanceCoverage
    : "unknown";
  const customFields = (section) => (
    <CustomFieldFormFields
      definitions={customFieldDefs}
      values={editFields.customFieldValues || {}}
      onChange={(values) => setEditFields((previous) => ({ ...previous, customFieldValues: values }))}
      idPrefix="license-edit"
      section={section}
    />
  );

  return (
    <div className="dp-edit-form">
      <div className="dp-edit-title">Edit License Details</div>
      {editError && (
        <div style={{ color: "var(--red-text)", fontSize: 11, marginBottom: 8 }}>
          {editError}
        </div>
      )}
      {customFieldsLoading && <p className="set-muted-text">Loading custom fields...</p>}
      <div className="fg">
        <label htmlFor="license-edit-publisher">Publisher Name</label>
        <ReferenceCombobox id="license-edit-publisher" mode="publisher" value={editFields.publisherName} onChange={(value) => setEditFields((p) => ({ ...p, publisherName: value }))} />
      </div>
      <div className="fg">
        <label htmlFor="license-edit-software">Software Description</label>
        <input id="license-edit-software" className="fi" value={editFields.softwareDescription} onChange={(e) => setEditFields((p) => ({ ...p, softwareDescription: e.target.value }))} />
      </div>
      {customFields("identity")}
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
        <div className="fg"><label htmlFor="license-edit-purchase-date">Purchase Date</label><input id="license-edit-purchase-date" className="fi" type="date" value={editFields.purchaseDate || ""} onChange={(e) => setEditFields((previous) => ({ ...previous, purchaseDate: e.target.value }))} /></div>
        <div className="fg"><label htmlFor="license-edit-external-ref">External Reference</label><input id="license-edit-external-ref" className="fi" value={editFields.externalRef || ""} onChange={(e) => setEditFields((previous) => ({ ...previous, externalRef: e.target.value }))} /></div>
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
        <label htmlFor="license-edit-procurement-reference">Procurement reference</label>
        <input id="license-edit-procurement-reference" className="fi" value={editFields.procurementReference || ""} onChange={(e) => setEditFields((p) => ({ ...p, procurementReference: e.target.value }))} />
      </div>
      <div className="fg license-edit-invoices">
        <span className="fg-label">Invoice Numbers</span>
        <InvoiceNumberRows
          idPrefix="license-edit-invoice"
          rows={editFields.invoiceNumbers ?? [""]}
          onChange={(rows) => setEditFields((p) => ({ ...p, invoiceNumbers: rows }))}
        />
      </div>
      {customFields("dates")}
      <div className="fg">
        <label htmlFor="license-edit-contact">Supplier Contact</label>
        <input id="license-edit-contact" className="fi" type="email" value={editFields.contactEmail} onChange={(e) => setEditFields((p) => ({ ...p, contactEmail: e.target.value }))} />
        <span className="field-hint">{SUPPLIER_CONTACT_HELP}</span>
      </div>
      <div className="fg">
        <label htmlFor="license-edit-budget-owner">Budget Owner Email</label>
        <ContactCombobox id="license-edit-budget-owner" value={editFields.budgetOwnerEmail || ""} onChange={(value) => setEditFields((p) => ({ ...p, budgetOwnerEmail: value }))} placeholder="owner@example.com" />
      </div>
      <div className="fg"><label htmlFor="license-edit-secondary-contacts">Secondary Contacts</label><ContactCombobox id="license-edit-secondary-contacts" multiple value={editFields.secondaryContacts || ""} placeholder="Separate email addresses with commas" onChange={(value) => setEditFields((previous) => ({ ...previous, secondaryContacts: value }))} /></div>
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-supplier">Supplier</label>
          <ReferenceCombobox id="license-edit-supplier" mode="supplier" value={editFields.supplier} onChange={(value) => setEditFields((p) => ({ ...p, supplier: value }))} placeholder="Reseller or direct supplier" />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-cost-centre">Cost Centre / Dept</label>
          <ReferenceCombobox id="license-edit-cost-centre" mode="costCentre" value={editFields.costCentre} onChange={(value) => setEditFields((p) => ({ ...p, costCentre: value }))} />
        </div>
      </div>
      {customFields("people")}
      <div className="fg"><label htmlFor="license-edit-total-price">Line Total</label><input id="license-edit-total-price" className="fi" inputMode="decimal" value={editFields.totalPoPrice || ""} onChange={(e) => setEditFields((previous) => ({ ...previous, totalPoPrice: parseTypedNumber(e.target.value, userSettings) ?? e.target.value }))} /></div>
      <div className="fg"><label htmlFor="license-edit-notes">Notes / Comments</label><textarea id="license-edit-notes" className="fi" rows={3} value={editFields.notes || ""} onChange={(e) => setEditFields((previous) => ({ ...previous, notes: e.target.value }))} /></div>
      {customFields("notes")}
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-type">License Type</label>
          <select id="license-edit-type" className="fi fi-select" value={editFields.licenseType} onChange={(e) => {
            const t = e.target.value;
            setEditFields((p) => {
              const options = maintenanceCoverageOptionsForLicenseType(t);
              const nextCoverage = options.some((option) => option.value === p.maintenanceCoverage)
                ? p.maintenanceCoverage
                : defaultMaintenanceCoverageForLicenseType(t);
              return {
                ...p,
                licenseType: t,
                maintenanceCoverage: nextCoverage,
                ...(t !== "saas" ? { portalUrl: "" } : {}),
              };
            });
          }}>
            <option value="">—</option>
            {licenseTypeOptions.map((t) => <option key={t.value} value={t.value} disabled={t.disabled}>{t.label}</option>)}
          </select>
          {currentLicenseType !== "maintenance" && activeMaintenanceId && (
            <span className="field-hint">This license has active maintenance of its own; unlink it before changing the type to Maintenance.</span>
          )}
        </div>
        <div className="fg">
          <label htmlFor="license-edit-metric">License Metric</label>
          <select id="license-edit-metric" className="fi fi-select" value={editFields.licenseMetric} onChange={(e) => setEditFields((p) => ({ ...p, licenseMetric: e.target.value }))}>
            <option value="">—</option>
            {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {switchingToMaintenance && (
        <div className="fg">
          <span className="fg-label">Maintenance for</span>
          <LinkPicker
            candidates={parentCandidates}
            selectedIds={editFields.parentLicenseId ? [Number(editFields.parentLicenseId)] : []}
            onChange={(ids) => setEditFields((p) => ({ ...p, parentLicenseId: ids[0] ? String(ids[0]) : "" }))}
            searchPlaceholder="Search by LT ref, publisher, description, PO, contract, or date"
            listLabel="Licenses this maintenance can cover"
            emptyMessage="No eligible parent licenses found."
          />
          {!editFields.parentLicenseId && <span className="field-hint">Choose the license this maintenance covers to save.</span>}
        </div>
      )}
      <LicenseTypeOptInFields
        idPrefix="license-edit"
        licenseType={editFields.licenseType}
        isRenewable={editFields.isRenewable}
        typeDescription={editFields.typeDescription}
        onChange={(field, value) => setEditFields((previous) => ({ ...previous, [field]: value }))}
        error={descriptionMissing ? TYPE_DESCRIPTION_REQUIRED_MESSAGE : null}
      />
      {editFields.licenseType === "saas" && (
        <div className="fg">
          <label htmlFor="license-edit-portal-url">Portal URL</label>
          <input id="license-edit-portal-url" className="fi" value={editFields.portalUrl || ""} onChange={(e) => setEditFields((p) => ({ ...p, portalUrl: e.target.value }))} placeholder="https://..." />
        </div>
      )}
      {supportsMaintenanceCoverage(editFields.licenseType) && (
        <div className="fg">
          <label htmlFor="license-edit-maintenance-coverage">Maintenance / Support Coverage</label>
          <select id="license-edit-maintenance-coverage" className="fi fi-select" value={maintenanceCoverageValue} onChange={(e) => setEditFields((p) => ({ ...p, maintenanceCoverage: e.target.value }))}>
            {maintenanceCoverageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )}
      {showQuickLink && setQuickLinkMaintenanceId && (
        <div className="fg">
          <span className="fg-label">Link an existing maintenance record (optional)</span>
          <LinkPicker
            candidates={quickLinkCandidates}
            selectedIds={quickLinkMaintenanceId ? [Number(quickLinkMaintenanceId)] : []}
            onChange={(ids) => setQuickLinkMaintenanceId(ids[0] ? String(ids[0]) : "")}
            searchPlaceholder="Search by LT ref, publisher, description, PO, contract, or date"
            listLabel="Existing maintenance records"
            emptyMessage="No eligible maintenance records were found."
          />
        </div>
      )}
      {customFields("maintenance")}
      <div className="fr">
        <div className="fg">
          <label htmlFor="license-edit-quantity">Purchase Quantity</label>
          <input id="license-edit-quantity" className="fi" inputMode="decimal" value={editFields.quantity} onChange={(e) => setEditFields((p) => ({ ...p, quantity: parseTypedNumber(e.target.value, userSettings) ?? e.target.value }))} />
        </div>
        <div className="fg">
          <label htmlFor="license-edit-quantity-per-unit">Quantity per Unit</label>
          <input id="license-edit-quantity-per-unit" className="fi" inputMode="decimal" value={editFields.quantityPerUnit || "1"} onChange={(e) => setEditFields((p) => ({ ...p, quantityPerUnit: parseTypedNumber(e.target.value, userSettings) ?? e.target.value }))} />
        </div>
      </div>
      <div className="fr">
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
              setEditFields((p) => ({ ...p, unitPrice: parseTypedNumber(e.target.value, userSettings) ?? e.target.value }));
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
      {customFields("commercial")}
      {customFields("documents")}
      {customFields("__catchall__")}
      <div className="dp-btn-row">
        <button className="btn btn-g btn-sm" disabled={savingLicense} onClick={onCancel}>Cancel</button>
        <button className="btn btn-p btn-sm" disabled={savingLicense || descriptionMissing || (switchingToMaintenance && !editFields.parentLicenseId)} onClick={onSave}>
          <Icon name="check" size={12} /> {savingLicense ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

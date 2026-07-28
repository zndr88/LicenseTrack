import React, { useRef, useState } from "react";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES } from "../../constants/licenseData.js";
import Checkbox from "../ui/Checkbox.jsx";
import Icon from "../ui/Icon.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import PluginSlot from "../plugins/PluginSlot.jsx";
import MaintenanceCoverageFields, {
  isFreewareLicenseType,
} from "../procurement/MaintenanceCoverageFields.jsx";

const formatStrategyLabel = (data) => {
  if (data.strategyUsed === "manual") return "Manual entry";
  return "Manual entry";
};

const DOC_CATEGORY_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "quote", label: "Quote" },
  { value: "purchase_order", label: "Purchase Order" },
  { value: "eula", label: "EULA" },
  { value: "entitlement", label: "Entitlement / License Key" },
];

const emptyAdditionalLine = (primaryForm) => ({
  id: `${Date.now()}-${Math.random()}`,
  softwareDescription: "",
  licenseType: primaryForm.licenseType || "",
  licenseMetric: primaryForm.licenseMetric || "",
  startDate: primaryForm.startDate || "",
  endDate: primaryForm.endDate || "",
  noticeDate: primaryForm.noticeDate || "",
  isPerpetual: primaryForm.isPerpetual || false,
  quantity: "",
  skuCode: "",
  unitPrice: "",
  totalPoPrice: "",
  currency: primaryForm.currency || "EUR",
  notes: "",
  portalUrl: "",
  maintenanceCoverage: "unknown",
  maintenanceStartDate: "",
  maintenanceEndDate: "",
  maintenancePricingBasis: "flat",
  maintenanceQuantity: "",
  maintenanceUnitPrice: "",
  maintenanceCost: "",
  parentLineIndex: null,
  isMaintenanceCompanion: false,
});

const InvoiceConfirmModal = ({ data, userSettings, onConfirm, onCancel }) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileCategory, setAttachedFileCategory] = useState("invoice");
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [additionalLines, setAdditionalLines] = useState([]);
  const [formTouched, setFormTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const handleFileChange = (file) => {
    setAttachedFile(file);
    if (!file) { setAttachedFileBase64(null); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachedFileBase64(reader.result.split(",")[1] ?? null);
    reader.readAsDataURL(file);
  };

  const [form, setForm] = useState({
    publisherName: data.publisherName || "", softwareDescription: data.softwareDescription || "",
    startDate: data.startDate || "", endDate: data.endDate || "", noticeDate: data.noticeDate || "",
    contractNumber: data.contractNumber || "", poNumber: data.poNumber || "",
    invoiceNumber: data.invoiceNumber || "", contactEmail: data.contactEmail || "",
    isPerpetual: data.endDate === "Perpetual",
    supplier: data.supplier || "", costCentre: data.costCentre || "",
    licenseType: data.licenseType || "", licenseMetric: data.licenseMetric || "",
    portalUrl: data.portalUrl || "",
    quantity: data.quantity || "", skuCode: data.skuCode || "", unitPrice: data.unitPrice || "",
    totalPoPrice: data.totalPoPrice || "", currency: data.currency || "EUR", notes: data.notes || "",
    budgetOwnerEmail: data.budgetOwnerEmail || "",
    maintenanceCoverage: data.maintenanceCoverage || "unknown",
    maintenanceStartDate: data.maintenanceStartDate || "",
    maintenanceEndDate: data.maintenanceEndDate || "",
    maintenancePricingBasis: data.maintenancePricingBasis || "flat",
    maintenanceQuantity: data.maintenanceQuantity || "",
    maintenanceUnitPrice: data.maintenanceUnitPrice || "",
    maintenanceCost: data.maintenanceCost || "",
  });
  const u = (k, v) => { setFormTouched(true); setForm((f) => ({ ...f, [k]: v })); };
  const vis = userSettings.visibleInDetail;

  const [displayUnitPrice, setDisplayUnitPrice] = useState(
    formatPriceInput(data.unitPrice || "", locale)
  );
  const [displayTotalPrice, setDisplayTotalPrice] = useState(
    formatPriceInput(data.totalPoPrice || "", locale)
  );

  const addLine = () => { setFormTouched(true); setAdditionalLines((prev) => [...prev, emptyAdditionalLine(form)]); };
  const maintenanceLineAdded = additionalLines.some((line) => line.isMaintenanceCompanion);
  const addMaintenanceLine = () => {
    if (maintenanceLineAdded) return;
    setFormTouched(true);
    setAdditionalLines((prev) => [
      ...prev,
      {
        ...emptyAdditionalLine(form),
        softwareDescription: `${form.softwareDescription || "Software"} maintenance/support`,
        licenseType: "maintenance",
        startDate: form.maintenanceStartDate || form.startDate || "",
        endDate: form.maintenanceEndDate || form.endDate || "",
        quantity: form.quantity || "1",
        currency: form.currency || "EUR",
        parentLineIndex: 0,
        isMaintenanceCompanion: true,
      },
    ]);
  };
  const removeLine = (id) => setAdditionalLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id, field, value) =>
    setAdditionalLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const isDirty = formTouched || additionalLines.length > 0 || !!attachedFile;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

  const handleSave = async () => {
    if (submitLockRef.current) return;

    // Merge each additional line with shared fields from primary form
    const sharedFields = {
      publisherName: form.publisherName,
      supplier: form.supplier,
      costCentre: form.costCentre,
      contactEmail: form.contactEmail,
      contractNumber: form.contractNumber,
      poNumber: form.poNumber,
      invoiceNumber: form.invoiceNumber,
      budgetOwnerEmail: form.budgetOwnerEmail,
    };
    const allForms = [
      {
        ...form,
        unitPrice: isFreewareLicenseType(form.licenseType) ? "" : form.unitPrice,
        totalPoPrice: isFreewareLicenseType(form.licenseType) ? "" : form.totalPoPrice,
        maintenanceQuantity: (parseLocalizedNumber(form.maintenanceQuantity, userSettings) ?? form.maintenanceQuantity) || "",
        maintenanceUnitPrice: (parseLocalizedNumber(form.maintenanceUnitPrice, userSettings) ?? form.maintenanceUnitPrice) || "",
        maintenanceCost: (parseLocalizedNumber(form.maintenanceCost, userSettings) ?? form.maintenanceCost) || "",
      },
      ...additionalLines.map((line) => ({
        ...sharedFields,
        softwareDescription: line.softwareDescription,
        licenseType: line.licenseType,
        licenseMetric: line.licenseMetric,
        startDate: line.startDate || form.startDate,
        endDate: line.isPerpetual ? "Perpetual" : line.endDate,
        isPerpetual: line.isPerpetual,
        quantity: line.quantity,
        skuCode: line.skuCode,
        unitPrice: line.unitPrice,
        totalPoPrice: line.totalPoPrice,
        currency: line.currency || form.currency,
        notes: line.notes,
        portalUrl: line.portalUrl,
        maintenanceCoverage: line.maintenanceCoverage,
        maintenanceStartDate: line.maintenanceStartDate,
        maintenanceEndDate: line.maintenanceEndDate,
        maintenancePricingBasis: line.maintenancePricingBasis,
        maintenanceQuantity: (parseLocalizedNumber(line.maintenanceQuantity, userSettings) ?? line.maintenanceQuantity) || "",
        maintenanceUnitPrice: (parseLocalizedNumber(line.maintenanceUnitPrice, userSettings) ?? line.maintenanceUnitPrice) || "",
        maintenanceCost: (parseLocalizedNumber(line.maintenanceCost, userSettings) ?? line.maintenanceCost) || "",
        parentLineIndex: line.parentLineIndex,
      })),
    ];
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const completed = await onConfirm(allForms, attachedFile, attachedFileCategory);
      if (completed === false) {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    } catch {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const lineCount = 1 + additionalLines.length;

  return (
    <>
    <ModalShell
      title="Review License Data"
      titleId="dialog-title-invoice-confirm"
      onClose={() => {
        if (!submitLockRef.current) requestClose();
      }}
      closeButtonDisabled={isSubmitting}
      closeOnOverlayClick={!isSubmitting}
      footer={(
        <>
          <button className="btn btn-g" onClick={requestClose} disabled={isSubmitting}>Cancel</button>
          <button className="btn btn-p" onClick={handleSave} disabled={isSubmitting}>
            <Icon name="check" size={14} />
            {isSubmitting
              ? "Saving..."
              : (lineCount > 1 ? `Save ${lineCount} Licenses` : "Save License")}
          </button>
        </>
      )}
    >
        <div className="modal-bd">
          <div className="fs">
            <h4><Icon name="shield" size={14} color="var(--accent)" /> {formatStrategyLabel(data)}: {data.fileName}</h4>
            <p style={{ fontSize: 11, color: "var(--text-3)" }}>Review and correct any fields before saving.</p>
          </div>
          {/* Attach document - kept at the top so it sits with the Parse Document
              action it feeds, matching the sourcing and pending-order modals. */}
          <div className="fg" style={{ borderBottom: "1px solid var(--border-lt)", paddingBottom: 12, marginBottom: 4 }}>
            <label>Attach Document <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional — attached to first license)</span></label>
            {attachedFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <Icon name="file" size={14} color="var(--text-2)" />
                <span style={{ fontSize: 12, color: "var(--text-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedFile.name}</span>
                <button type="button" className="btn btn-g" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => handleFileChange(null)}>Remove</button>
              </div>
            ) : (
              <input id="inv-attach-file" type="file" className="fi" style={{ marginTop: 4 }} onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
            )}
          </div>
          {attachedFile && (
            <div className="fg" style={{ marginBottom: 4 }}>
              <label htmlFor="inv-attach-category">Document Category</label>
              <select id="inv-attach-category" className="fi fi-select" value={attachedFileCategory} onChange={(e) => setAttachedFileCategory(e.target.value)}>
                {DOC_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="plugin-slot-form-row">
            <PluginSlot
              slot="license.add.review.actions"
              context={{
                targetType: "license_draft",
                targetId: data.draftId || "manual",
                draftId: data.draftId || "manual",
                draftFields: form,
                documentIds: data.documentIds || [],
                stagedFileToken: data.stagedFileToken,
                detectedDocumentCategory: data.detectedDocumentCategory,
                ...(attachedFileBase64 ? {
                  fileContentBase64: attachedFileBase64,
                  fileName: attachedFile?.name,
                  contentType: attachedFile?.type || "application/pdf",
                } : {}),
              }}
              onResult={(result) => {
                // Multi-item parse: fill primary form + create additional lines
                if (Array.isArray(result?.multiItems) && result.multiItems.length > 0) {
                  const ITEM_FIELDS = [
                    "publisherName", "softwareDescription", "startDate", "endDate", "noticeDate",
                    "contractNumber", "poNumber", "invoiceNumber", "contactEmail",
                    "supplier", "costCentre", "licenseType", "licenseMetric",
                    "quantity", "skuCode", "unitPrice", "totalPoPrice", "currency",
                    "notes", "budgetOwnerEmail", "portalUrl",
                  ];
                  const first = result.multiItems[0];
                  ITEM_FIELDS.forEach((field) => {
                    if (first[field] != null && first[field] !== "") u(field, String(first[field]));
                  });
                  if (result.multiItems.length > 1) {
                    setAdditionalLines(result.multiItems.slice(1).map((item) => ({
                      id: `${Date.now()}-${Math.random()}`,
                      softwareDescription: item.softwareDescription ?? "",
                      licenseType: item.licenseType ?? "",
                      licenseMetric: item.licenseMetric ?? "",
                      startDate: item.startDate ?? first.startDate ?? "",
                      endDate: item.endDate ?? first.endDate ?? "",
                      noticeDate: item.noticeDate ?? first.noticeDate ?? "",
                      isPerpetual: false,
                      quantity: item.quantity ?? "",
                      skuCode: item.skuCode ?? "",
                      unitPrice: item.unitPrice ?? "",
                      totalPoPrice: item.totalPoPrice ?? "",
                      currency: item.currency ?? first.currency ?? "EUR",
                      notes: item.notes ?? "",
                      portalUrl: item.portalUrl ?? "",
                    })));
                  }
                  return;
                }
                // Single-item suggestions
                const suggestions = result?.draftSuggestions;
                if (!Array.isArray(suggestions)) return;
                const FORM_FIELDS = new Set([
                  "publisherName", "softwareDescription", "startDate", "endDate", "noticeDate",
                  "contractNumber", "poNumber", "invoiceNumber", "contactEmail",
                  "supplier", "costCentre", "licenseType", "licenseMetric",
                  "quantity", "skuCode", "unitPrice", "totalPoPrice", "currency",
                  "notes", "budgetOwnerEmail",
                ]);
                suggestions.forEach(({ field, value, confidence }) => {
                  if (FORM_FIELDS.has(field) && value != null && value !== "" && (confidence == null || confidence >= 0.35)) {
                    u(field, String(value));
                  }
                });
              }}
            />
          </div>
          <div className="fg"><label htmlFor="inv-publisher-name">Publisher Name</label><input id="inv-publisher-name" className="fi" value={form.publisherName} onChange={(e) => u("publisherName", e.target.value)} /></div>
          <div className="fg"><label htmlFor="inv-software-desc">Software Description</label><input id="inv-software-desc" className="fi" value={form.softwareDescription} onChange={(e) => u("softwareDescription", e.target.value)} /></div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-start-date">Start Date</label><input id="inv-start-date" type="date" className="fi" value={form.startDate} onChange={(e) => u("startDate", e.target.value)} /></div>
            <div className="fg">
              <label htmlFor="inv-end-date">End Date</label>
              {form.isPerpetual ? <input className="fi" value="Perpetual" disabled /> : <input id="inv-end-date" type="date" className="fi" value={form.endDate} onChange={(e) => u("endDate", e.target.value)} />}
              <div style={{ marginTop: 5 }}><Checkbox checked={form.isPerpetual} onChange={(v) => { u("isPerpetual", v); if (v) u("endDate", "Perpetual"); else u("endDate", ""); }} label="Perpetual license" /></div>
            </div>
          </div>
          <div className="fg"><label htmlFor="inv-notice-date">Notice Date</label><input id="inv-notice-date" type="date" className="fi" value={form.noticeDate || ""} onChange={(e) => u("noticeDate", e.target.value)} />{form.noticeDate && form.endDate && form.endDate !== "Perpetual" && form.noticeDate > form.endDate && <div className="dp-field-warning">Notice date is after the license end date.</div>}</div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-contract-number">Contract Number</label><input id="inv-contract-number" className="fi" value={form.contractNumber} onChange={(e) => u("contractNumber", e.target.value)} /></div>
            <div className="fg"><label htmlFor="inv-po-number">PO Number</label><input id="inv-po-number" className="fi" value={form.poNumber} onChange={(e) => u("poNumber", e.target.value)} /></div>
          </div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-invoice-number">Invoice Number</label><input id="inv-invoice-number" className="fi" value={form.invoiceNumber} onChange={(e) => u("invoiceNumber", e.target.value)} /></div>
            <div className="fg"><label htmlFor="inv-contact-email">Contact Email</label><input id="inv-contact-email" className="fi" value={form.contactEmail} onChange={(e) => u("contactEmail", e.target.value)} /></div>
          </div>

          {/* Toggleable categories */}
          {(vis.supplier || vis.costCentre) && (
            <div className="fr">
              {vis.supplier && <div className="fg"><label htmlFor="inv-supplier">Supplier</label><input id="inv-supplier" className="fi" value={form.supplier} placeholder="Reseller or direct supplier" onChange={(e) => u("supplier", e.target.value)} /></div>}
              {vis.costCentre && <div className="fg"><label htmlFor="inv-cost-centre">Cost Centre / Department</label><input id="inv-cost-centre" className="fi" value={form.costCentre} placeholder="Department or cost centre" onChange={(e) => u("costCentre", e.target.value)} /></div>}
            </div>
          )}
          {(vis.licenseType || vis.licenseMetric) && (
            <div className="fr">
              {vis.licenseType && (
                <div className="fg"><label htmlFor="inv-license-type">License Type</label>
                  <select id="inv-license-type" className="fi fi-select" value={form.licenseType} onChange={(e) => {
                    const next = e.target.value;
                    setForm((f) => ({
                      ...f,
                      licenseType: next,
                      ...(next !== "saas" ? { portalUrl: "" } : {}),
                      ...(isFreewareLicenseType(next) ? { unitPrice: "", totalPoPrice: "" } : {}),
                    }));
                    if (isFreewareLicenseType(next)) {
                      setDisplayUnitPrice("");
                      setDisplayTotalPrice("");
                    }
                  }}>
                    <option value="">Select...</option>
                    {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              )}
              {vis.licenseMetric && (
                <div className="fg"><label htmlFor="inv-license-metric">License Metric</label>
                  <select id="inv-license-metric" className="fi fi-select" value={form.licenseMetric} onChange={(e) => u("licenseMetric", e.target.value)}>
                    <option value="">Select...</option>
                    {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <MaintenanceCoverageFields
            idPrefix="inv"
            licenseType={form.licenseType}
            coverage={form.maintenanceCoverage}
            startDate={form.maintenanceStartDate}
            endDate={form.maintenanceEndDate}
            pricingBasis={form.maintenancePricingBasis}
            supportQuantity={form.maintenanceQuantity}
            supportUnitPrice={form.maintenanceUnitPrice}
            cost={form.maintenanceCost}
            licenseQuantity={form.quantity}
            currency={form.currency}
            locale={locale}
            onChange={u}
            onAddSeparate={addMaintenanceLine}
            separateLineAdded={maintenanceLineAdded}
          />
          {form.licenseType === "saas" && (
            <div className="fg">
              <label htmlFor="inv-portal-url">Portal URL</label>
              <input id="inv-portal-url" className="fi" value={form.portalUrl} onChange={(e) => u("portalUrl", e.target.value)} placeholder="https://..." />
            </div>
          )}
          {(vis.quantity || vis.skuCode) && (
            <div className="fr">
              {vis.quantity && <div className="fg"><label htmlFor="inv-quantity">Purchase Quantity</label><input id="inv-quantity" className="fi" type="number" value={form.quantity} onChange={(e) => u("quantity", e.target.value)} /></div>}
              {vis.skuCode && <div className="fg"><label htmlFor="inv-sku-code">SKU Code</label><input id="inv-sku-code" className="fi" value={form.skuCode} placeholder="SKU or product code" onChange={(e) => u("skuCode", e.target.value)} /></div>}
            </div>
          )}
          {!isFreewareLicenseType(form.licenseType) && (vis.unitPrice || vis.totalPoPrice) && (
            <div className="fr">
              {vis.unitPrice && (
                <div className="fg">
                  <label htmlFor="inv-unit-price">Unit Price</label>
                  <input
                    id="inv-unit-price"
                    className="fi"
                    value={displayUnitPrice}
                    onFocus={() => setDisplayUnitPrice(form.unitPrice)}
                    onChange={(e) => {
                      setDisplayUnitPrice(e.target.value);
                      u("unitPrice", parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value);
                    }}
                    onBlur={() => setDisplayUnitPrice(formatPriceInput(form.unitPrice, locale))}
                  />
                </div>
              )}
              {vis.totalPoPrice && (
                <div className="fg">
                  <label htmlFor="inv-total-price">Total PO Price</label>
                  <input
                    id="inv-total-price"
                    className="fi"
                    value={displayTotalPrice}
                    onFocus={() => setDisplayTotalPrice(form.totalPoPrice)}
                    onChange={(e) => {
                      setDisplayTotalPrice(e.target.value);
                      u("totalPoPrice", parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value);
                    }}
                    onBlur={() => setDisplayTotalPrice(formatPriceInput(form.totalPoPrice, locale))}
                  />
                </div>
              )}
            </div>
          )}
          {(isFreewareLicenseType(form.licenseType) || vis.unitPrice || vis.totalPoPrice) && (
            <div className="fg"><label htmlFor="inv-currency">Currency</label>
              <select id="inv-currency" className="fi fi-select" value={form.currency} onChange={(e) => u("currency", e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div className="fg"><label htmlFor="inv-budget-owner">Budget Owner Email</label><input id="inv-budget-owner" className="fi" value={form.budgetOwnerEmail} placeholder="owner@example.com" onChange={(e) => u("budgetOwnerEmail", e.target.value)} /></div>
          {vis.notes && <div className="fg"><label htmlFor="inv-notes">Notes / Comments</label><textarea id="inv-notes" className="fi" rows={3} value={form.notes} onChange={(e) => u("notes", e.target.value)} style={{ resize: "vertical" }} /></div>}

          {/* Additional license lines */}
          {additionalLines.map((line, idx) => (
            <div key={line.id} style={{ borderTop: "1px solid var(--border-lt)", paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                  License {idx + 2} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— inherits publisher, supplier, invoice & contract details above</span>
                </span>
                <button type="button" className="btn btn-g" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => removeLine(line.id)}>
                  <Icon name="x" size={12} /> Remove
                </button>
              </div>
              <div className="fg">
                <label>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input className="fi" value={line.softwareDescription} onChange={(e) => updateLine(line.id, "softwareDescription", e.target.value)} placeholder="Product or service name" />
              </div>
              <div className="fr">
                <div className="fg">
                  <label>Start Date</label>
                  <input type="date" className="fi" value={line.startDate} onChange={(e) => updateLine(line.id, "startDate", e.target.value)} />
                </div>
                <div className="fg">
                  <label>End Date</label>
                  {line.isPerpetual
                    ? <input className="fi" value="Perpetual" disabled />
                    : <input type="date" className="fi" value={line.endDate} onChange={(e) => updateLine(line.id, "endDate", e.target.value)} />
                  }
                  <div style={{ marginTop: 5 }}>
                    <Checkbox
                      checked={line.isPerpetual}
                      onChange={(v) => updateLine(line.id, "isPerpetual", v)}
                      label="Perpetual license"
                    />
                  </div>
                </div>
                <div className="fg">
                  <label>Notice Date</label>
                  <input type="date" className="fi" value={line.noticeDate || ""} onChange={(e) => updateLine(line.id, "noticeDate", e.target.value)} />
                  {line.noticeDate && line.endDate && line.endDate !== "Perpetual" && line.noticeDate > line.endDate && <div className="dp-field-warning">Notice date is after the license end date.</div>}
                </div>
              </div>
              <div className="fr">
                {vis.licenseType && (
                  <div className="fg">
                    <label>License Type</label>
                    <select className="fi fi-select" value={line.licenseType} onChange={(e) => {
                      const next = e.target.value;
                      updateLine(line.id, "licenseType", next);
                      if (next !== "saas") updateLine(line.id, "portalUrl", "");
                      if (isFreewareLicenseType(next)) {
                        updateLine(line.id, "unitPrice", "");
                        updateLine(line.id, "totalPoPrice", "");
                      }
                    }}>
                      <option value="">Select...</option>
                      {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                )}
                {vis.licenseMetric && (
                  <div className="fg">
                    <label>License Metric</label>
                    <select className="fi fi-select" value={line.licenseMetric} onChange={(e) => updateLine(line.id, "licenseMetric", e.target.value)}>
                      <option value="">Select...</option>
                      {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {line.licenseType === "saas" && (
                <div className="fg">
                  <label>Portal URL</label>
                  <input className="fi" value={line.portalUrl} onChange={(e) => updateLine(line.id, "portalUrl", e.target.value)} placeholder="https://..." />
                </div>
              )}
              <div className="fr">
                {vis.quantity && (
                  <div className="fg">
                    <label>Purchase Quantity</label>
                    <input type="number" className="fi" value={line.quantity} onChange={(e) => updateLine(line.id, "quantity", e.target.value)} />
                  </div>
                )}
                {vis.skuCode && (
                  <div className="fg">
                    <label>SKU Code</label>
                    <input className="fi" value={line.skuCode} onChange={(e) => updateLine(line.id, "skuCode", e.target.value)} placeholder="SKU or product code" />
                  </div>
                )}
              </div>
              {!isFreewareLicenseType(line.licenseType) && (vis.unitPrice || vis.totalPoPrice) && (
                <div className="fr">
                  {vis.unitPrice && (
                    <div className="fg">
                      <label>Unit Price</label>
                      <input className="fi" value={line.unitPrice} onChange={(e) => updateLine(line.id, "unitPrice", e.target.value)} placeholder="0.00" />
                    </div>
                  )}
                  {vis.totalPoPrice && (
                    <div className="fg">
                      <label>Total PO Price</label>
                      <input className="fi" value={line.totalPoPrice} onChange={(e) => updateLine(line.id, "totalPoPrice", e.target.value)} placeholder="0.00" />
                    </div>
                  )}
                  <div className="fg" style={{ flex: "0 0 90px" }}>
                    <label>Currency</label>
                    <select className="fi fi-select" value={line.currency} onChange={(e) => updateLine(line.id, "currency", e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {vis.notes && (
                <div className="fg">
                  <label>Notes</label>
                  <textarea className="fi" rows={2} value={line.notes} onChange={(e) => updateLine(line.id, "notes", e.target.value)} style={{ resize: "vertical" }} />
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            className="btn btn-g"
            style={{ marginTop: 12, fontSize: 12 }}
            onClick={addLine}
          >
            <Icon name="plus" size={12} /> Add additional license line
          </button>
        </div>
    </ModalShell>
    {showDiscardDialog && (
      <DiscardChangesDialog
        onKeep={() => setShowDiscardDialog(false)}
        onDiscard={onCancel}
      />
    )}
    </>
  );
};

export default InvoiceConfirmModal;

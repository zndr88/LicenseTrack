import React, { useEffect, useRef, useState } from "react";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES } from "../../constants/licenseData.js";
import Checkbox from "../ui/Checkbox.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import Icon from "../ui/Icon.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import PluginSlot from "../plugins/PluginSlot.jsx";
import MaintenanceCoverageFields, {
  isFreewareLicenseType,
  supportsSeparateMaintenanceLine,
} from "../procurement/MaintenanceCoverageFields.jsx";
import ParentLicensePicker from "../procurement/ParentLicensePicker.jsx";
import { getLicenses } from "../../api/licenses.js";
import CustomFieldFormFields from "./CustomFieldFormFields.jsx";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { buildCustomFieldValuePayload, customFieldValueMap } from "../../utils/customFieldFormValues.js";
import { FULL_LICENSE_FORM_VISIBILITY } from "../../utils/licenseFormVisibility.js";

const PRIMARY_LINE_ID = "primary";
const PROCUREMENT_DOCUMENT_CATEGORIES = new Set(["invoice", "quote", "purchase_order"]);

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
  purchaseDate: primaryForm.purchaseDate || "",
  isPerpetual: primaryForm.isPerpetual || false,
  quantity: "",
  quantityPerUnit: primaryForm.quantityPerUnit || "1",
  skuCode: "",
  unitPrice: "",
  totalPoPrice: "",
  currency: primaryForm.currency || "EUR",
  notes: "",
  externalRef: "",
  secondaryContacts: "",
  customFieldValues: {},
  portalUrl: "",
  maintenanceCoverage: "unknown",
  maintenanceStartDate: "",
  maintenanceEndDate: "",
  maintenancePricingBasis: "flat",
  maintenanceQuantity: "",
  maintenanceUnitPrice: "",
  maintenanceCost: "",
  parentLineId: null,
  isMaintenanceCompanion: false,
});

const normalizeLocalizedValue = (value, userSettings) => (
  (parseLocalizedNumber(value, userSettings) ?? value) || ""
);

const formatLocalizedPriceInput = (value, userSettings) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  return formatPriceInput(normalizeLocalizedValue(value, userSettings), locale);
};

const InvoiceConfirmModal = ({ data, userSettings, onConfirm, onCancel }) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileCategory, setAttachedFileCategory] = useState("invoice");
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [additionalLines, setAdditionalLines] = useState([]);
  const [formTouched, setFormTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [eligibleParentLicenses, setEligibleParentLicenses] = useState([]);
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();
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
    purchaseDate: data.purchaseDate || "",
    contractNumber: data.contractNumber || "", poNumber: data.poNumber || "",
    procurementReference: data.procurementReference || "",
    invoiceNumber: data.invoiceNumber || "", contactEmail: data.contactEmail || "",
    isPerpetual: data.endDate === "Perpetual",
    supplier: data.supplier || "", costCentre: data.costCentre || "",
    licenseType: data.licenseType || "", licenseMetric: data.licenseMetric || "",
    portalUrl: data.portalUrl || "",
    quantity: data.quantity || "", quantityPerUnit: data.quantityPerUnit || "1", skuCode: data.skuCode || "", unitPrice: data.unitPrice || "",
    totalPoPrice: data.totalPoPrice || "", currency: data.currency || "EUR", notes: data.notes || "",
    budgetOwnerEmail: data.budgetOwnerEmail || "",
    externalRef: data.externalRef || "",
    secondaryContacts: (data.secondaryContacts || []).join(", "),
    customFieldValues: customFieldValueMap(data.customFieldValues || data.customFields),
    maintenanceCoverage: data.maintenanceCoverage || "unknown",
    maintenanceStartDate: data.maintenanceStartDate || "",
    maintenanceEndDate: data.maintenanceEndDate || "",
    maintenancePricingBasis: data.maintenancePricingBasis || "flat",
    maintenanceQuantity: data.maintenanceQuantity || "",
    maintenanceUnitPrice: data.maintenanceUnitPrice || "",
    maintenanceCost: data.maintenanceCost || "",
    parentLicenseId: data.parentLicenseId || "",
  });
  const u = (k, v) => { setFormTouched(true); setForm((f) => ({ ...f, [k]: v })); };
  const vis = FULL_LICENSE_FORM_VISIBILITY;

  useEffect(() => {
    if (form.licenseType !== "maintenance") return undefined;
    let cancelled = false;
    getLicenses({ includeRetired: false }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      setEligibleParentLicenses(data);
    });
    return () => { cancelled = true; };
  }, [form.licenseType]);

  const [displayUnitPrice, setDisplayUnitPrice] = useState(
    formatPriceInput(data.unitPrice || "", locale)
  );
  const [displayTotalPrice, setDisplayTotalPrice] = useState(
    formatPriceInput(data.totalPoPrice || "", locale)
  );

  const addLine = () => {
    setFormTouched(true);
    setAdditionalLines((prev) => [...prev, emptyAdditionalLine(form)]);
  };
  const hasMaintenanceCompanion = (parentLineId) => additionalLines.some(
    (line) => line.isMaintenanceCompanion && line.parentLineId === parentLineId
  );
  const addMaintenanceLine = (parentLineId, parentForm) => {
    setFormTouched(true);
    setAdditionalLines((prev) => {
      if (prev.some((line) => line.isMaintenanceCompanion && line.parentLineId === parentLineId)) {
        return prev;
      }
      return [
        ...prev,
        {
          ...emptyAdditionalLine(parentForm),
          softwareDescription: `${parentForm.softwareDescription || "Software"} maintenance/support`,
          licenseType: "maintenance",
          startDate: parentForm.maintenanceStartDate || parentForm.startDate || "",
          endDate: parentForm.maintenanceEndDate || parentForm.endDate || "",
          quantity: parentForm.quantity || "1",
          quantityPerUnit: parentForm.quantityPerUnit || "1",
          currency: parentForm.currency || "EUR",
          parentLineId,
          isMaintenanceCompanion: true,
        },
      ];
    });
  };
  const removeMaintenanceCompanion = (parentLineId) => {
    setAdditionalLines((prev) => prev.filter(
      (line) => !(line.isMaintenanceCompanion && line.parentLineId === parentLineId)
    ));
  };
  const removeLine = (id) => setAdditionalLines((prev) => prev.filter(
    (line) => line.id !== id && line.parentLineId !== id
  ));
  const updateLine = (id, field, value) =>
    setAdditionalLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  const updatePrimaryMaintenance = (field, value) => {
    u(field, value);
    if (field === "maintenanceCoverage" && value !== "separately_tracked") {
      removeMaintenanceCompanion(PRIMARY_LINE_ID);
    }
  };
  const updateLineMaintenance = (lineId, field, value) => {
    updateLine(lineId, field, value);
    if (field === "maintenanceCoverage" && value !== "separately_tracked") {
      removeMaintenanceCompanion(lineId);
    }
  };

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
      procurementReference: form.procurementReference,
    };
    const lineIndexById = new Map(additionalLines.map((line, index) => [line.id, index + 1]));
    const allForms = [
      {
        ...form,
        unitPrice: isFreewareLicenseType(form.licenseType) ? "" : form.unitPrice,
        totalPoPrice: isFreewareLicenseType(form.licenseType) ? "" : form.totalPoPrice,
        quantityPerUnit: normalizeLocalizedValue(form.quantityPerUnit, userSettings) || "1",
        secondaryContacts: String(form.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
        customFieldValues: buildCustomFieldValuePayload(customFieldDefs, form.customFieldValues, userSettings),
        maintenanceQuantity: normalizeLocalizedValue(form.maintenanceQuantity, userSettings),
        maintenanceUnitPrice: normalizeLocalizedValue(form.maintenanceUnitPrice, userSettings),
        maintenanceCost: normalizeLocalizedValue(form.maintenanceCost, userSettings),
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
        quantityPerUnit: normalizeLocalizedValue(line.quantityPerUnit, userSettings) || "1",
        purchaseDate: line.purchaseDate || form.purchaseDate,
        externalRef: line.externalRef,
        secondaryContacts: String(line.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
        customFieldValues: buildCustomFieldValuePayload(customFieldDefs, line.customFieldValues, userSettings),
        skuCode: line.skuCode,
        unitPrice: isFreewareLicenseType(line.licenseType)
          ? ""
          : normalizeLocalizedValue(line.unitPrice, userSettings),
        totalPoPrice: isFreewareLicenseType(line.licenseType)
          ? ""
          : normalizeLocalizedValue(line.totalPoPrice, userSettings),
        currency: line.currency || form.currency,
        notes: line.notes,
        portalUrl: line.portalUrl,
        maintenanceCoverage: line.maintenanceCoverage,
        maintenanceStartDate: line.maintenanceStartDate,
        maintenanceEndDate: line.maintenanceEndDate,
        maintenancePricingBasis: line.maintenancePricingBasis,
        maintenanceQuantity: normalizeLocalizedValue(line.maintenanceQuantity, userSettings),
        maintenanceUnitPrice: normalizeLocalizedValue(line.maintenanceUnitPrice, userSettings),
        maintenanceCost: normalizeLocalizedValue(line.maintenanceCost, userSettings),
        parentLineIndex: line.isMaintenanceCompanion
          ? (line.parentLineId === PRIMARY_LINE_ID ? 0 : lineIndexById.get(line.parentLineId))
          : null,
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
  const attachmentScopeHint = lineCount > 1 && PROCUREMENT_DOCUMENT_CATEGORIES.has(attachedFileCategory)
    ? `shared across all ${lineCount} licenses in this batch`
    : "attached to first license";

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
      modalClassName={`modal${attachedFile ? " document-assisted-modal" : ""}`}
      modalStyle={attachedFile ? {
        width: "min(1120px, 94vw)",
        maxWidth: "min(1120px, 94vw)",
        overflow: "hidden",
      } : undefined}
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
        <div className={`document-assisted-modal-layout${attachedFile ? " has-document-preview" : ""}`}>
          <LocalDocumentPreviewPanel
            ariaLabel="Attached license document preview"
            file={attachedFile}
            label="Document Preview"
          />
          <div className="modal-bd document-assisted-modal-form">
          <div className="fs">
            <h4><Icon name="shield" size={14} color="var(--accent)" /> Manual entry: {data.fileName}</h4>
            <p style={{ fontSize: 11, color: "var(--text-3)" }}>Review and correct any fields before saving.</p>
          </div>
          {/* Attach document - kept at the top so it sits with the Parse Document
              action it feeds, matching the sourcing and pending-order modals. */}
          <div className="fg" style={{ borderBottom: "1px solid var(--border-lt)", paddingBottom: 12, marginBottom: 4 }}>
            {attachedFile ? (
              <div className="fg-label">Attach Document <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional — {attachmentScopeHint})</span></div>
            ) : (
              <label htmlFor="inv-attach-file">Attach Document <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional — {attachmentScopeHint})</span></label>
            )}
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
                      ...emptyAdditionalLine({ ...form, ...first, ...item }),
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
                      maintenanceCoverage: item.maintenanceCoverage ?? "unknown",
                      maintenanceStartDate: item.maintenanceStartDate ?? "",
                      maintenanceEndDate: item.maintenanceEndDate ?? "",
                      maintenancePricingBasis: item.maintenancePricingBasis ?? "flat",
                      maintenanceQuantity: item.maintenanceQuantity ?? "",
                      maintenanceUnitPrice: item.maintenanceUnitPrice ?? "",
                      maintenanceCost: item.maintenanceCost ?? "",
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
          <div className="fg"><label htmlFor="inv-publisher-name">Publisher Name</label><ReferenceCombobox id="inv-publisher-name" mode="publisher" value={form.publisherName} onChange={(value) => u("publisherName", value)} /></div>
          <div className="fg"><label htmlFor="inv-software-desc">Software Description</label><input id="inv-software-desc" className="fi" value={form.softwareDescription} onChange={(e) => u("softwareDescription", e.target.value)} /></div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-start-date">Start Date</label><input id="inv-start-date" type="date" className="fi" value={form.startDate} onChange={(e) => u("startDate", e.target.value)} /></div>
            <div className="fg">
              <label htmlFor="inv-end-date">End Date</label>
              {form.isPerpetual ? <input id="inv-end-date" className="fi" value="Perpetual" disabled /> : <input id="inv-end-date" type="date" className="fi" value={form.endDate} onChange={(e) => u("endDate", e.target.value)} />}
              <div style={{ marginTop: 5 }}><Checkbox checked={form.isPerpetual} onChange={(v) => { u("isPerpetual", v); if (v) u("endDate", "Perpetual"); else u("endDate", ""); }} label="Perpetual license" /></div>
            </div>
          </div>
          <div className="fg"><label htmlFor="inv-notice-date">Notice Date</label><input id="inv-notice-date" type="date" className="fi" value={form.noticeDate || ""} onChange={(e) => u("noticeDate", e.target.value)} />{form.noticeDate && form.endDate && form.endDate !== "Perpetual" && form.noticeDate > form.endDate && <div className="dp-field-warning">Notice date is after the license end date.</div>}</div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-purchase-date">Purchase Date</label><input id="inv-purchase-date" type="date" className="fi" value={form.purchaseDate || ""} onChange={(e) => u("purchaseDate", e.target.value)} /></div>
            <div className="fg"><label htmlFor="inv-external-ref">External Reference</label><input id="inv-external-ref" className="fi" value={form.externalRef || ""} onChange={(e) => u("externalRef", e.target.value)} /></div>
          </div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-contract-number">Contract Number</label><input id="inv-contract-number" className="fi" value={form.contractNumber} onChange={(e) => u("contractNumber", e.target.value)} /></div>
            <div className="fg"><label htmlFor="inv-po-number">PO Number</label><input id="inv-po-number" className="fi" value={form.poNumber} onChange={(e) => u("poNumber", e.target.value)} /></div>
          </div>
          <div className="fg"><label htmlFor="inv-procurement-reference">Procurement Reference</label><input id="inv-procurement-reference" className="fi" value={form.procurementReference || ""} onChange={(e) => u("procurementReference", e.target.value)} /></div>
          <div className="fr">
            <div className="fg"><label htmlFor="inv-invoice-number">Invoice Number</label><input id="inv-invoice-number" className="fi" value={form.invoiceNumber} onChange={(e) => u("invoiceNumber", e.target.value)} /></div>
            <div className="fg"><label htmlFor="inv-contact-email">Contact Email</label><input id="inv-contact-email" className="fi" value={form.contactEmail} onChange={(e) => u("contactEmail", e.target.value)} /></div>
          </div>

          {/* Toggleable categories */}
          {(vis.supplier || vis.costCentre) && (
            <div className="fr">
              {vis.supplier && <div className="fg"><label htmlFor="inv-supplier">Supplier</label><ReferenceCombobox id="inv-supplier" mode="supplier" value={form.supplier} placeholder="Reseller or direct supplier" onChange={(value) => u("supplier", value)} /></div>}
              {vis.costCentre && <div className="fg"><label htmlFor="inv-cost-centre">Cost Centre / Department</label><ReferenceCombobox id="inv-cost-centre" mode="costCentre" value={form.costCentre} placeholder="Department or cost centre" onChange={(value) => u("costCentre", value)} /></div>}
            </div>
          )}
          {(vis.licenseType || vis.licenseMetric) && (
            <div className="fr">
              {vis.licenseType && (
                <div className="fg"><label htmlFor="inv-license-type">License Type</label>
                  <select id="inv-license-type" className="fi fi-select" value={form.licenseType} onChange={(e) => {
                    const next = e.target.value;
                    setFormTouched(true);
                    setForm((f) => ({
                      ...f,
                      licenseType: next,
                      ...(next !== "maintenance" ? { parentLicenseId: "" } : {}),
                      ...(next !== "saas" ? { portalUrl: "" } : {}),
                      ...(isFreewareLicenseType(next) ? { unitPrice: "", totalPoPrice: "" } : {}),
                    }));
                    if (isFreewareLicenseType(next)) {
                      setDisplayUnitPrice("");
                      setDisplayTotalPrice("");
                    }
                    if (!supportsSeparateMaintenanceLine(next)) {
                      removeMaintenanceCompanion(PRIMARY_LINE_ID);
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
            licenseStartDate={form.startDate}
            licenseEndDate={form.isPerpetual ? "" : form.endDate}
            licenseTotalCost={form.totalPoPrice}
            currency={form.currency}
            locale={locale}
            onChange={updatePrimaryMaintenance}
            onAddSeparate={() => addMaintenanceLine(PRIMARY_LINE_ID, form)}
            separateLineAdded={hasMaintenanceCompanion(PRIMARY_LINE_ID)}
          />
          {form.licenseType === "maintenance" && (
            <ParentLicensePicker
              id="inv-parent-license"
              licenses={eligibleParentLicenses}
              parentLicenseId={form.parentLicenseId}
              parentSourcingItemId={null}
              onSelectExisting={(value) => u("parentLicenseId", value)}
              onSelectPoItem={() => {}}
              error={!form.parentLicenseId ? "Select the perpetual, OEM, or freeware license this maintenance record supports." : null}
            />
          )}
          {form.licenseType === "saas" && (
            <div className="fg">
              <label htmlFor="inv-portal-url">Portal URL</label>
              <input id="inv-portal-url" className="fi" value={form.portalUrl} onChange={(e) => u("portalUrl", e.target.value)} placeholder="https://..." />
            </div>
          )}
          {(vis.quantity || vis.quantityPerUnit || vis.skuCode) && (
            <div className="fr">
              {vis.quantity && <div className="fg"><label htmlFor="inv-quantity">Purchase Quantity</label><input id="inv-quantity" className="fi" type="number" value={form.quantity} onChange={(e) => u("quantity", e.target.value)} /></div>}
              {vis.quantityPerUnit && <div className="fg"><label htmlFor="inv-quantity-per-unit">Quantity per Unit</label><input id="inv-quantity-per-unit" className="fi" inputMode="decimal" value={form.quantityPerUnit} onChange={(e) => u("quantityPerUnit", e.target.value)} /></div>}
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
          <div className="fg"><label htmlFor="inv-secondary-contacts">Secondary Contacts</label><input id="inv-secondary-contacts" className="fi" value={form.secondaryContacts || ""} placeholder="Separate email addresses with commas" onChange={(e) => u("secondaryContacts", e.target.value)} /></div>
          {vis.notes && <div className="fg"><label htmlFor="inv-notes">Notes / Comments</label><textarea id="inv-notes" className="fi" rows={3} value={form.notes} onChange={(e) => u("notes", e.target.value)} style={{ resize: "vertical" }} /></div>}
          <CustomFieldFormFields
            definitions={customFieldDefs}
            values={form.customFieldValues}
            onChange={(values) => u("customFieldValues", values)}
            idPrefix="inv"
            loading={customFieldsLoading}
          />

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
                <label htmlFor={`inv-line-${line.id}-software`}>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input id={`inv-line-${line.id}-software`} className="fi" value={line.softwareDescription} onChange={(e) => updateLine(line.id, "softwareDescription", e.target.value)} placeholder="Product or service name" />
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`inv-line-${line.id}-start-date`}>Start Date</label>
                  <input id={`inv-line-${line.id}-start-date`} type="date" className="fi" value={line.startDate} onChange={(e) => updateLine(line.id, "startDate", e.target.value)} />
                </div>
                <div className="fg">
                  <label htmlFor={`inv-line-${line.id}-end-date`}>End Date</label>
                  {line.isPerpetual
                    ? <input id={`inv-line-${line.id}-end-date`} className="fi" value="Perpetual" disabled />
                    : <input id={`inv-line-${line.id}-end-date`} type="date" className="fi" value={line.endDate} onChange={(e) => updateLine(line.id, "endDate", e.target.value)} />
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
                  <label htmlFor={`inv-line-${line.id}-notice-date`}>Notice Date</label>
                  <input id={`inv-line-${line.id}-notice-date`} type="date" className="fi" value={line.noticeDate || ""} onChange={(e) => updateLine(line.id, "noticeDate", e.target.value)} />
                  {line.noticeDate && line.endDate && line.endDate !== "Perpetual" && line.noticeDate > line.endDate && <div className="dp-field-warning">Notice date is after the license end date.</div>}
                </div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor={`inv-line-${line.id}-purchase-date`}>Purchase Date</label><input id={`inv-line-${line.id}-purchase-date`} type="date" className="fi" value={line.purchaseDate || ""} onChange={(e) => updateLine(line.id, "purchaseDate", e.target.value)} /></div>
                <div className="fg"><label htmlFor={`inv-line-${line.id}-external-ref`}>External Reference</label><input id={`inv-line-${line.id}-external-ref`} className="fi" value={line.externalRef || ""} onChange={(e) => updateLine(line.id, "externalRef", e.target.value)} /></div>
              </div>
              <div className="fr">
                {vis.licenseType && (
                  <div className="fg">
                    <label htmlFor={`inv-line-${line.id}-license-type`}>License Type</label>
                    <select id={`inv-line-${line.id}-license-type`} className="fi fi-select" value={line.licenseType} onChange={(e) => {
                      const next = e.target.value;
                      updateLine(line.id, "licenseType", next);
                      if (next !== "saas") updateLine(line.id, "portalUrl", "");
                      if (isFreewareLicenseType(next)) {
                        updateLine(line.id, "unitPrice", "");
                        updateLine(line.id, "totalPoPrice", "");
                      }
                      if (!supportsSeparateMaintenanceLine(next)) {
                        removeMaintenanceCompanion(line.id);
                      }
                    }}>
                      <option value="">Select...</option>
                      {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                )}
                {vis.licenseMetric && (
                  <div className="fg">
                    <label htmlFor={`inv-line-${line.id}-license-metric`}>License Metric</label>
                    <select id={`inv-line-${line.id}-license-metric`} className="fi fi-select" value={line.licenseMetric} onChange={(e) => updateLine(line.id, "licenseMetric", e.target.value)}>
                      <option value="">Select...</option>
                      {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <MaintenanceCoverageFields
                idPrefix={`inv-line-${line.id}`}
                licenseType={line.licenseType}
                coverage={line.maintenanceCoverage}
                startDate={line.maintenanceStartDate}
                endDate={line.maintenanceEndDate}
                pricingBasis={line.maintenancePricingBasis}
                supportQuantity={line.maintenanceQuantity}
                supportUnitPrice={line.maintenanceUnitPrice}
                cost={line.maintenanceCost}
                licenseQuantity={line.quantity}
                licenseStartDate={line.startDate}
                licenseEndDate={line.isPerpetual ? "" : line.endDate}
                licenseTotalCost={line.totalPoPrice}
                currency={line.currency}
                locale={locale}
                onChange={(field, value) => updateLineMaintenance(line.id, field, value)}
                onAddSeparate={() => addMaintenanceLine(line.id, line)}
                separateLineAdded={hasMaintenanceCompanion(line.id)}
              />
              {line.licenseType === "saas" && (
                <div className="fg">
                  <label htmlFor={`inv-line-${line.id}-portal-url`}>Portal URL</label>
                  <input id={`inv-line-${line.id}-portal-url`} className="fi" value={line.portalUrl} onChange={(e) => updateLine(line.id, "portalUrl", e.target.value)} placeholder="https://..." />
                </div>
              )}
              <div className="fr">
                {vis.quantity && (
                  <div className="fg">
                    <label htmlFor={`inv-line-${line.id}-quantity`}>Purchase Quantity</label>
                    <input id={`inv-line-${line.id}-quantity`} type="number" className="fi" value={line.quantity} onChange={(e) => updateLine(line.id, "quantity", e.target.value)} />
                  </div>
                )}
                {vis.quantityPerUnit && (
                  <div className="fg">
                    <label htmlFor={`inv-line-${line.id}-quantity-per-unit`}>Quantity per Unit</label>
                    <input id={`inv-line-${line.id}-quantity-per-unit`} className="fi" inputMode="decimal" value={line.quantityPerUnit} onChange={(e) => updateLine(line.id, "quantityPerUnit", e.target.value)} />
                  </div>
                )}
                {vis.skuCode && (
                  <div className="fg">
                    <label htmlFor={`inv-line-${line.id}-sku-code`}>SKU Code</label>
                    <input id={`inv-line-${line.id}-sku-code`} className="fi" value={line.skuCode} onChange={(e) => updateLine(line.id, "skuCode", e.target.value)} placeholder="SKU or product code" />
                  </div>
                )}
              </div>
              {!isFreewareLicenseType(line.licenseType) && (vis.unitPrice || vis.totalPoPrice) && (
                <div className="fr">
                  {vis.unitPrice && (
                    <div className="fg">
                      <label htmlFor={`inv-line-${line.id}-unit-price`}>Unit Price</label>
                      <input
                        id={`inv-line-${line.id}-unit-price`}
                        className="fi"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(line.id, "unitPrice", e.target.value)}
                        onBlur={(e) => updateLine(
                          line.id,
                          "unitPrice",
                          formatLocalizedPriceInput(e.target.value, userSettings)
                        )}
                        placeholder={formatPriceInput("0.00", locale)}
                      />
                    </div>
                  )}
                  {vis.totalPoPrice && (
                    <div className="fg">
                      <label htmlFor={`inv-line-${line.id}-total-price`}>Total PO Price</label>
                      <input
                        id={`inv-line-${line.id}-total-price`}
                        className="fi"
                        value={line.totalPoPrice}
                        onChange={(e) => updateLine(line.id, "totalPoPrice", e.target.value)}
                        onBlur={(e) => updateLine(
                          line.id,
                          "totalPoPrice",
                          formatLocalizedPriceInput(e.target.value, userSettings)
                        )}
                        placeholder={formatPriceInput("0.00", locale)}
                      />
                    </div>
                  )}
                  <div className="fg" style={{ flex: "0 0 90px" }}>
                    <label htmlFor={`inv-line-${line.id}-currency`}>Currency</label>
                    <select id={`inv-line-${line.id}-currency`} className="fi fi-select" value={line.currency} onChange={(e) => updateLine(line.id, "currency", e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {vis.notes && (
                <div className="fg">
                  <label htmlFor={`inv-line-${line.id}-notes`}>Notes</label>
                  <textarea id={`inv-line-${line.id}-notes`} className="fi" rows={2} value={line.notes} onChange={(e) => updateLine(line.id, "notes", e.target.value)} style={{ resize: "vertical" }} />
                </div>
              )}
              <div className="fg"><label htmlFor={`inv-line-${line.id}-secondary-contacts`}>Secondary Contacts</label><input id={`inv-line-${line.id}-secondary-contacts`} className="fi" value={line.secondaryContacts || ""} placeholder="Separate email addresses with commas" onChange={(e) => updateLine(line.id, "secondaryContacts", e.target.value)} /></div>
              <CustomFieldFormFields
                definitions={customFieldDefs}
                values={line.customFieldValues || {}}
                onChange={(values) => updateLine(line.id, "customFieldValues", values)}
                idPrefix={`inv-line-${line.id}`}
                loading={customFieldsLoading}
              />
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

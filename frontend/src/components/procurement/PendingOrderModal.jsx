import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { poFormSchema } from "../../utils/procurementSchemas.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import Icon from "../ui/Icon.jsx";
import PluginSlot from "../plugins/PluginSlot.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import LicenseDraftSupplementFields, { licenseDraftSupplementDefaults } from "../licenses/LicenseDraftSupplementFields.jsx";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { buildCustomFieldValuePayload } from "../../utils/customFieldFormValues.js";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import ProcurementDocumentWorkspace from "./ProcurementDocumentWorkspace.jsx";
import { previewPendingOrderDocument } from "../../api/pendingOrders.js";
import MaintenanceCoverageFields, { supportsMaintenanceCoverage } from "./MaintenanceCoverageFields.jsx";
import CustomFieldFormFields from "../licenses/CustomFieldFormFields.jsx";
import { LICENSE_METRICS, LICENSE_TYPES } from "../../constants/licenseData.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"];

const emptyItem = () => ({
  ...licenseDraftSupplementDefaults,
  id: `${Date.now()}-${Math.random()}`,
  publisherName: "",
  softwareDescription: "",
  quantity: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  supplier: "",
  contactEmail: "",
});

const PendingOrderModal = ({ order, userSettings, onSave, onCancel }) => {
  const isNewOrder = !order;
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();

  const {
    register,
    control,
    handleSubmit,
    formState: { isDirty },
    reset,
    setValue,
  } = useForm({
    resolver: zodResolver(poFormSchema),
    defaultValues: {
      poNumber: order?.poNumber ?? "",
      procurementReference: order?.procurementReference ?? "",
      supplier: order?.supplier ?? "",
      notes:    order?.notes    ?? "",
    },
  });

  const [items, setItems] = useState([emptyItem()]);
  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [slotHasActions, setSlotHasActions] = useState(false);
  const [saving, setSaving] = useState(false);

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: isDirty || !!attachedFile,
    onClose: onCancel,
  });

  const handleFileChange = (file) => {
    setAttachedFile(file);
    if (!file) { setAttachedFileBase64(null); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachedFileBase64(reader.result.split(",")[1] ?? null);
    reader.readAsDataURL(file);
  };

  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === "estimatedUnitPrice" || field === "quantity") {
        const qtyRaw = field === "quantity" ? value : item.quantity;
        const unitRaw = field === "estimatedUnitPrice" ? value : item.estimatedUnitPrice;
        const qty = parseFloat(parseLocalizedNumber(qtyRaw, userSettings) ?? qtyRaw);
        const unit = parseFloat(parseLocalizedNumber(unitRaw, userSettings) ?? unitRaw);
        if (!isNaN(qty) && qty > 0 && !isNaN(unit) && unit > 0) {
          updated.estimatedTotalPrice = formatPriceInput(String(qty * unit), locale);
        }
      }
      return updated;
    }));

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (id) => setItems((prev) => prev.length > 1 ? prev.filter((i) => i.id !== id) : prev);

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (isNewOrder) {
        const normalizedItems = items.map((item) => ({
          ...item,
          quantity: parseLocalizedNumber(item.quantity, userSettings) ?? item.quantity,
          quantityPerUnit: parseLocalizedNumber(item.quantityPerUnit, userSettings) ?? item.quantityPerUnit,
          estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? item.estimatedUnitPrice,
          estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? item.estimatedTotalPrice,
          secondaryContacts: String(item.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
          customFieldValues: buildCustomFieldValuePayload(customFieldDefs, item.customFieldValues, userSettings),
        }));
        const saved = await onSave({ ...data, items: normalizedItems, quoteFile: attachedFile || null });
        if (saved) {
          reset();
          setItems([emptyItem()]);
          handleFileChange(null);
        }
      } else {
        const saved = await onSave({ ...data, quoteFile: attachedFile || null });
        if (saved) reset();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ModalShell
        title={order ? "Edit Pending Order" : "Add Pending Order"}
        titleId="dialog-title-pending-order"
        onClose={requestClose}
        modalClassName="modal document-assisted-modal"
        modalStyle={{
          width: "min(1120px, 94vw)",
          maxWidth: "min(1120px, 94vw)",
          overflow: "hidden",
        }}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={saving} onClick={handleSubmit(onSubmit)}>
              {saving ? "Saving..." : isNewOrder && items.filter((i) => i.publisherName.trim()).length > 0
                ? `Save Pending Order + ${items.filter((i) => i.publisherName.trim()).length} Item${items.filter((i) => i.publisherName.trim()).length > 1 ? "s" : ""}`
                : "Save"}
            </button>
          </>
        )}
      >
        <div className="license-intake-modal-layout">
          <div className="modal-bd document-assisted-modal-form">
          <div className="license-form-stack">
          {/* Plugin slot - always mounted so it can discover actions; visually hidden when no actions */}
          {isNewOrder && (
            <div className="plugin-slot-form-row" style={slotHasActions ? undefined : { display: "none" }}>
              <PluginSlot
                slot="pendingOrder.add.actions"
                context={{
                  targetType: "pending_order_draft",
                  targetId: "new",
                  ...(attachedFileBase64 ? {
                    fileContentBase64: attachedFileBase64,
                    fileName: attachedFile?.name,
                    contentType: attachedFile?.type || "application/pdf",
                  } : {}),
                }}
                onActionsLoaded={(count) => setSlotHasActions(count > 0)}
                onResult={(result) => {
                  const mis = result?.multiItems;
                  if (!Array.isArray(mis) || mis.length === 0) return;
                  const first = mis[0];
                  if (first.poNumber) setValue("poNumber", first.poNumber, { shouldDirty: true });
                  if (first.procurementReference) setValue("procurementReference", first.procurementReference, { shouldDirty: true });
                  if (first.supplier) setValue("supplier", first.supplier, { shouldDirty: true });
                  setItems(mis.map((item) => ({
                    ...licenseDraftSupplementDefaults,
                    id: `${Date.now()}-${Math.random()}`,
                    publisherName: item.publisherName ?? "",
                    softwareDescription: item.softwareDescription ?? "",
                    quantity: item.quantity ?? "",
                    estimatedUnitPrice: item.estimatedUnitPrice ?? "",
                    estimatedTotalPrice: item.estimatedTotalPrice ?? "",
                    currency: item.currency ?? first.currency ?? "EUR",
                    supplier: item.supplier ?? first.supplier ?? "",
                    contactEmail: item.contactEmail ?? "",
                  })));
                }}
              />
            </div>
          )}

          {/* Pending order header fields */}
          <LicenseFormSection title="Order Details">
          <div className="fg">
            <label htmlFor="po-number">PO Number</label>
            <input id="po-number" className="fi" placeholder="e.g. PO-2026-0042" {...register("poNumber")} />
          </div>
          <div className="fg">
            <label htmlFor="po-procurement-reference">Procurement reference</label>
            <input id="po-procurement-reference" className="fi" placeholder="e.g. REQ-2026-0042" {...register("procurementReference")} />
          </div>
          <div className="fg">
            <label htmlFor="po-supplier">Supplier</label>
            <Controller
              name="supplier"
              control={control}
              render={({ field }) => (
                <ReferenceCombobox id="po-supplier" mode="supplier" placeholder="Reseller or direct supplier" {...field} />
              )}
            />
          </div>
          <div className="fg">
            <label htmlFor="po-notes">Notes</label>
            <textarea id="po-notes" className="fi" rows={2} placeholder="PO notes" style={{ resize: "vertical" }} {...register("notes")} />
          </div>
          </LicenseFormSection>

          {/* Inline line items - new order only */}
          {isNewOrder && (
            <div style={{ borderTop: "1px solid var(--border-lt)", paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>License Line Items <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional — add now or after saving)</span></span>
              </div>
              {items.map((item, idx) => (
                <div key={item.id} className="pending-order-license-line">
                  {items.length > 1 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>Item {idx + 1}</span>
                      <button type="button" className="btn btn-g" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => removeItem(item.id)}>
                        <Icon name="x" size={11} /> Remove
                      </button>
                    </div>
                  )}
                  <LicenseFormSection title="Identity">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                    <div className="fg" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor={`pending-item-${item.id}-publisher`}>Publisher</label>
                      <ReferenceCombobox id={`pending-item-${item.id}-publisher`} mode="publisher" placeholder="Software publisher" value={item.publisherName} onChange={(value) => updateItem(item.id, "publisherName", value)} />
                    </div>
                    <div className="fg" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor={`pending-item-${item.id}-software`}>Software Description</label>
                      <input id={`pending-item-${item.id}-software`} className="fi" placeholder="Product or service name" value={item.softwareDescription} onChange={(e) => updateItem(item.id, "softwareDescription", e.target.value)} />
                    </div>
                    <div className="fg" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor={`pending-item-${item.id}-type`}>License Type</label>
                      <select id={`pending-item-${item.id}-type`} className="fi fi-select" value={item.licenseType} onChange={(event) => updateItem(item.id, "licenseType", event.target.value)}>
                        <option value="">Not specified</option>
                        {LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <CustomFieldFormFields definitions={customFieldDefs} values={item.customFieldValues || {}} onChange={(values) => updateItem(item.id, "customFieldValues", values)} idPrefix={`pending-item-${item.id}`} loading={customFieldsLoading} section="identity" />
                  </LicenseFormSection>
                  {customFieldDefs.some((definition) => definition.section === "documents") && (
                    <LicenseFormSection title="Documents">
                      <CustomFieldFormFields definitions={customFieldDefs} values={item.customFieldValues || {}} onChange={(values) => updateItem(item.id, "customFieldValues", values)} idPrefix={`pending-item-${item.id}`} loading={customFieldsLoading} section="documents" />
                    </LicenseFormSection>
                  )}
                  <LicenseDraftSupplementFields
                    item={item}
                    onChange={(field, value) => updateItem(item.id, field, value)}
                    idPrefix={`pending-item-${item.id}`}
                    customFieldDefs={customFieldDefs}
                    customFieldsLoading={customFieldsLoading}
                    sectioned
                    commercialSummary={(
                      <>
                        <div className="fr">
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-quantity`}>Purchase Quantity</label><input id={`pending-item-${item.id}-quantity`} className="fi" inputMode="decimal" placeholder="e.g. 10" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} /></div>
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-quantity-per-unit`}>Quantity per Unit</label><input id={`pending-item-${item.id}-quantity-per-unit`} className="fi" inputMode="decimal" value={item.quantityPerUnit} onChange={(e) => updateItem(item.id, "quantityPerUnit", e.target.value)} /></div>
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-sku`}>SKU Code</label><input id={`pending-item-${item.id}-sku`} className="fi" value={item.skuCode} onChange={(e) => updateItem(item.id, "skuCode", e.target.value)} /></div>
                        </div>
                        <div className="fr">
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-metric`}>License Metric</label><select id={`pending-item-${item.id}-metric`} className="fi fi-select" value={item.licenseMetric} onChange={(event) => updateItem(item.id, "licenseMetric", event.target.value)}>{LICENSE_METRICS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-currency`}>Currency</label><select id={`pending-item-${item.id}-currency`} className="fi fi-select" value={item.currency} onChange={(e) => updateItem(item.id, "currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                        </div>
                        <div className="fr">
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-unit-price`}>Unit Price</label><input id={`pending-item-${item.id}-unit-price`} className="fi" inputMode="decimal" placeholder={`e.g. ${formatPriceInput("500", locale)}`} value={item.estimatedUnitPrice} onChange={(e) => updateItem(item.id, "estimatedUnitPrice", e.target.value)} /></div>
                          <div className="fg"><label htmlFor={`pending-item-${item.id}-total-price`}>Total Price</label><input id={`pending-item-${item.id}-total-price`} className="fi" inputMode="decimal" placeholder={`e.g. ${formatPriceInput("5000", locale)}`} value={item.estimatedTotalPrice} onChange={(e) => updateItem(item.id, "estimatedTotalPrice", e.target.value)} /></div>
                        </div>
                        {item.licenseType === "saas" && <div className="fg"><label htmlFor={`pending-item-${item.id}-portal`}>Portal URL</label><input id={`pending-item-${item.id}-portal`} className="fi" value={item.portalUrl} onChange={(event) => updateItem(item.id, "portalUrl", event.target.value)} /></div>}
                      </>
                    )}
                    showCoreDetails={false}
                    maintenanceSection={supportsMaintenanceCoverage(item.licenseType) ? (
                      <LicenseFormSection title="Maintenance / Support">
                        <MaintenanceCoverageFields idPrefix={`pending-item-${item.id}`} licenseType={item.licenseType} coverage={item.maintenanceCoverage} startDate={item.maintenanceStartDate} endDate={item.maintenanceEndDate} pricingBasis={item.maintenancePricingBasis} supportQuantity={item.maintenanceQuantity} supportUnitPrice={item.maintenanceUnitPrice} cost={item.maintenanceCost} licenseQuantity={item.quantity} licenseStartDate={item.startDate} licenseEndDate={item.endDate} licenseTotalCost={item.estimatedTotalPrice} currency={item.currency} locale={locale} onChange={(field, value) => updateItem(item.id, field, value)} embedded />
                        <CustomFieldFormFields definitions={customFieldDefs} values={item.customFieldValues || {}} onChange={(values) => updateItem(item.id, "customFieldValues", values)} idPrefix={`pending-item-${item.id}`} loading={customFieldsLoading} section="maintenance" />
                      </LicenseFormSection>
                    ) : null}
                  />
                </div>
              ))}
              <button type="button" className="btn btn-g" style={{ fontSize: 12, marginTop: 2 }} onClick={addItem}>
                <Icon name="plus" size={12} /> Add another item
              </button>
            </div>
          )}
          </div>
        </div>
          <ProcurementDocumentWorkspace
            documents={order?.documents ?? []}
            file={attachedFile}
            inputId="pending-order-file"
            label="Purchase Order Document"
            onFileChange={handleFileChange}
            previewDocument={previewPendingOrderDocument}
          />
        </div>
      </ModalShell>
      {showDiscardDialog && (
        <DiscardChangesDialog
          onDiscard={() => { reset(); onCancel(); }}
          onKeep={() => setShowDiscardDialog(false)}
        />
      )}
    </>
  );
};

export default PendingOrderModal;

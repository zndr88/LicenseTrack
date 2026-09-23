import React, { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CURRENCIES, LICENSE_METRICS, LICENSE_TYPES, SUPPLIER_CONTACT_HELP } from "../../constants/licenseData.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import {
  canonicalizeQuantityInput,
  formatQuantity,
} from "../../utils/quantity.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import Icon from "../ui/Icon.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import ContactCombobox from "../ui/ContactCombobox.jsx";
import PluginSlot from "../plugins/PluginSlot.jsx";
import MaintenanceCoverageFields, {
  isFreewareLicenseType,
  supportsMaintenanceCoverage,
  supportsSeparateMaintenanceLine,
} from "./MaintenanceCoverageFields.jsx";
import CustomFieldFormSection, { CustomFieldPlacement } from "../licenses/CustomFieldFormSection.jsx";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import LicenseDraftSupplementFields from "../licenses/LicenseDraftSupplementFields.jsx";
import LicenseIdentityFormSection from "../licenses/LicenseIdentityFormSection.jsx";
import LicenseDatesContractFormSection from "../licenses/LicenseDatesContractFormSection.jsx";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import DocumentStagingWorkspace from "./DocumentStagingWorkspace.jsx";
import { useStagedDocumentAttachments } from "./useStagedDocumentAttachments.js";
import { buildMaintenanceCompanion } from "../../utils/maintenanceCompanion.js";
import { useLicenseLines } from "../../hooks/useLicenseLines.js";
import {
  getSourcingItemInitialTotal,
  maintenanceCompanionToPayload,
  sourcingAdditionalLineToPayload,
  sourcingEditFormToPayload,
  sourcingItemToFormDefaults,
  sourcingPrimaryFormToPayload,
} from "../../utils/sourcingItemFormModel.js";
import { previewSourcingQuoteDocument, downloadSourcingQuoteDocument } from "../../api/sourcing.js";
import { previewConversionDocument, downloadConversionDocument } from "./conversionDocuments.js";
import { filterCustomFieldDefinitionsForRenewal } from "../../utils/customFieldRenewal.js";
import { filterCustomFieldDefinitionsForSourcing } from "../../utils/customFieldSourcing.js";
import TermLinkContext from "./TermLinkContext.jsx";
import LineTotalMismatchHint from "./LineTotalMismatchHint.jsx";
import LicenseTypeOptInFields from "../licenses/LicenseTypeOptInFields.jsx";
import { TYPE_DESCRIPTION_REQUIRED_MESSAGE, typeDescriptionMissing } from "../../utils/licenseTypeRules.js";

const schema = z.object({
  publisherName:       z.string().min(1, "Publisher is required."),
  softwareDescription: z.string().min(1, "Software description is required."),
  licenseType:         z.string(),
  licenseMetric:       z.string(),
  portalUrl:           z.string(),
  isRenewable:         z.boolean().nullable().optional(),
  typeDescription:     z.string().optional(),
  maintenanceCoverage: z.string(),
  maintenanceStartDate: z.string(),
  maintenanceEndDate:  z.string(),
  maintenancePricingBasis: z.string(),
  maintenanceQuantity: z.string(),
  maintenanceUnitPrice: z.string(),
  maintenanceCost:     z.string(),
  quantity:            z.string(),
  quantityPerUnit:     z.string(),
  skuCode:             z.string(),
  estimatedUnitPrice:  z.string(),
  estimatedTotalPrice: z.string(),
  currency:            z.string(),
  startDate:           z.string(),
  endDate:             z.string(),
  noticeDate:          z.string(),
  purchaseDate:        z.string(),
  contractNumber:      z.string(),
  invoiceNumber:       z.string(),
  externalRef:         z.string(),
  costCentre:          z.string(),
  budgetOwnerEmail:    z.string(),
  secondaryContacts:   z.string(),
  customFieldValues:   z.record(z.string(), z.union([z.string(), z.boolean()])),
  supplier:            z.string(),
  contactEmail:        z.string().refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    { message: "Must be a valid email address." }
  ),
  notes:               z.string(),
}).superRefine((data, ctx) => {
  if (typeDescriptionMissing(data.licenseType, data.typeDescription)) {
    ctx.addIssue({ code: "custom", path: ["typeDescription"], message: TYPE_DESCRIPTION_REQUIRED_MESSAGE });
  }
});

const emptyAdditionalLine = (overrides = {}) => ({
  id: `${Date.now()}-${Math.random()}`,
  publisherName: "",
  softwareDescription: "",
  licenseType: "",
  licenseMetric: "per_user",
  portalUrl: "",
  isRenewable: false,
  typeDescription: "",
  maintenanceCoverage: "unknown",
  maintenanceStartDate: "",
  maintenanceEndDate: "",
  maintenancePricingBasis: "flat",
  maintenanceQuantity: "",
  maintenanceUnitPrice: "",
  maintenanceCost: "",
  quantity: "",
  quantityPerUnit: "1",
  skuCode: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  startDate: "",
  endDate: "",
  noticeDate: "",
  purchaseDate: "",
  contractNumber: "",
  invoiceNumber: "",
  externalRef: "",
  costCentre: "",
  budgetOwnerEmail: "",
  secondaryContacts: "",
  customFieldValues: {},
  supplier: "",
  contactEmail: "",
  notes: "",
  parentItemIndex: null,
  parentLineId: null,
  isMaintenanceCompanion: false,
  ...overrides,
});

const SourcingItemModal = ({
  item,
  prefill = null,
  requestId,
  sourcingRequest,
  documents = [],
  pendingOrderId: parentPendingOrderId = null,
  userSettings,
  title,
  onSave,
  onCancel,
  onDeleteDocument,
  termItems = [],
  licenses = [],
  onAddNextTerm,
  onEditPredecessors,
}) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const { definitions: allCustomFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();
  const draftItem = item ?? prefill;
  const isRenewal = Boolean(draftItem?.isRenewal || draftItem?.renewalForLicenseId != null);
  const pendingOrderId = parentPendingOrderId ?? item?.pendingOrderId ?? item?.pending_order_id ?? null;
  const renewalCustomFieldDefs = filterCustomFieldDefinitionsForRenewal(allCustomFieldDefs, isRenewal);
  const customFieldDefs = pendingOrderId
    ? renewalCustomFieldDefs
    : filterCustomFieldDefinitionsForSourcing(renewalCustomFieldDefs);
  const sourcingRequestId = item?.sourcingRequestId
    ?? item?.sourcing_request_id
    ?? sourcingRequest?.id
    ?? null;
  const pluginSlot = pendingOrderId ? "pendingOrder.line.edit.actions" : "sourcing.item.edit.actions";
  const pluginTargetType = pendingOrderId ? "pending_order_item" : "sourcing_item";

  // Parent-create mode supports multiple lines. Pending-order additions reuse that
  // line editor, while sourcing-only quote actions remain limited to new requests.
  const isNewLineCollection = !item?.id && !requestId;
  const isNewSourcingRequest = isNewLineCollection && !pendingOrderId;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
    watch,
    setValue,
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: sourcingItemToFormDefaults(draftItem, sourcingRequest, licenses),
  });


  const { attachments, categoryScopes, addFiles, removeAttachment, changeTarget, changeCategoryScope, clearAttachments } = useStagedDocumentAttachments("primary");
  const attachedFile = attachments[0]?.file ?? null;
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [slotHasActions, setSlotHasActions] = useState(false);
  const {
    lines: additionalLines,
    setLines: setAdditionalLines,
    addLine: addAdditionalLine,
    removeLine: removeAdditionalLine,
    updateLine: updateAdditionalLine,
    addMaintenanceCompanion: addAdditionalMaintenanceLine,
    hasMaintenanceCompanion: hasAdditionalMaintenanceLine,
  } = useLicenseLines({
    emptyLine: emptyAdditionalLine,
    userSettings,
    priceFields: { quantity: "quantity", unitPrice: "estimatedUnitPrice", total: "estimatedTotalPrice" },
  });
  const [saving, setSaving] = useState(false);
  const [attachmentError, setAttachmentError] = useState(null);
  const [documentPreviewVisible, setDocumentPreviewVisible] = useState(false);
  const [pendingTermAction, setPendingTermAction] = useState(null);
  useEffect(() => {
    if (!attachedFile) { setAttachedFileBase64(null); return; }
    let current = true;
    const reader = new FileReader();
    reader.onload = () => { if (current) setAttachedFileBase64(reader.result.split(",")[1] ?? null); };
    reader.readAsDataURL(attachedFile);
    return () => { current = false; };
  }, [attachedFile]);


  const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);
  const [displayQuantity, setDisplayQuantity] = useState(
    formatQuantity(draftItem?.quantity, userSettings) || draftItem?.quantity || ""
  );
  const [displayUnitPrice, setDisplayUnitPrice] = useState(
    formatPriceInput(draftItem?.estimatedUnitPrice ?? "", locale)
  );
  const [displayTotalPrice, setDisplayTotalPrice] = useState(
    formatPriceInput(getSourcingItemInitialTotal(draftItem), locale)
  );

  const hasUnsavedChanges = isDirty || additionalLines.length > 0 || attachments.length > 0;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: hasUnsavedChanges,
    onClose: onCancel,
  });

  const requestTermAction = (action) => {
    if (hasUnsavedChanges) {
      setPendingTermAction(action);
      setShowDiscardDialog(true);
      return;
    }
    if (action === "add") onAddNextTerm?.();
    else onEditPredecessors?.();
  };

  const quantity = watch("quantity");
  const estimatedUnitPrice = watch("estimatedUnitPrice");
  const licenseType = watch("licenseType");
  const maintenanceCoverage = watch("maintenanceCoverage");
  const maintenanceStartDate = watch("maintenanceStartDate");
  const maintenanceEndDate = watch("maintenanceEndDate");
  const maintenancePricingBasis = watch("maintenancePricingBasis");
  const maintenanceQuantity = watch("maintenanceQuantity");
  const maintenanceUnitPrice = watch("maintenanceUnitPrice");
  const maintenanceCost = watch("maintenanceCost");
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const estimatedTotalPrice = watch("estimatedTotalPrice");

  useEffect(() => {
    const qtyStr = (quantity ?? "").trim();
    const unitStr = (estimatedUnitPrice ?? "").trim();
    if (!qtyStr && !unitStr) {
      setTotalManuallyEdited(false);
      setValue("estimatedTotalPrice", "", { shouldDirty: true });
      setDisplayTotalPrice("");
      return;
    }
    if (totalManuallyEdited) return;
    const qty = Number(parseLocalizedNumber(qtyStr, userSettings));
    const unit = Number(parseLocalizedNumber(unitStr, userSettings));
    if (!isNaN(qty) && !isNaN(unit)) {
      const computed = (qty * unit).toFixed(2);
      setValue("estimatedTotalPrice", computed, { shouldDirty: true });
      setDisplayTotalPrice(formatPriceInput(computed, locale));
    }
  }, [quantity, estimatedUnitPrice, totalManuallyEdited, setValue, userSettings, locale]);

  useEffect(() => {
    if (!isFreewareLicenseType(licenseType)) return;
    setValue("estimatedUnitPrice", "", { shouldDirty: true });
    setValue("estimatedTotalPrice", "", { shouldDirty: true });
    setDisplayUnitPrice("");
    setDisplayTotalPrice("");
    setTotalManuallyEdited(false);
  }, [licenseType, setValue]);

  useEffect(() => {
    if (supportsSeparateMaintenanceLine(licenseType)) return;
    setAdditionalLines((prev) => prev.filter((line) => !line.isMaintenanceCompanion));
  }, [licenseType, setAdditionalLines]);

  const publisherVal = watch("publisherName");
  const softwareVal = watch("softwareDescription");
  const currentFields = watch();
  const additionalLinesValid = additionalLines.every(
    (l) => (l.publisherName ?? "").trim() !== ""
      && (l.softwareDescription ?? "").trim() !== ""
      && !typeDescriptionMissing(l.licenseType, l.typeDescription)
  );
  const maintenanceLineAdded = additionalLines.some((line) => line.isMaintenanceCompanion);
  const addMaintenanceLine = () => {
    if (maintenanceLineAdded) return;
    const primary = {
      publisherName: publisherVal,
      softwareDescription: softwareVal,
      quantity,
      quantityPerUnit: watch("quantityPerUnit"),
      currency: watch("currency"),
      startDate: watch("startDate"),
      endDate: watch("endDate"),
      maintenanceStartDate,
      maintenanceEndDate,
      supplier: watch("supplier"),
      contactEmail: watch("contactEmail"),
      costCentre: watch("costCentre"),
      budgetOwnerEmail: watch("budgetOwnerEmail"),
      secondaryContacts: watch("secondaryContacts"),
    };
    setAdditionalLines((prev) => [
      ...prev,
      emptyAdditionalLine({ ...buildMaintenanceCompanion(primary), parentLineId: null, parentItemIndex: 0 }),
    ]);
  };
  const canSave =
    (publisherVal ?? "").trim() !== "" &&
    (softwareVal ?? "").trim() !== "" &&
    additionalLinesValid;

  const showAutoLabel =
    !totalManuallyEdited &&
    (quantity ?? "").trim() !== "" &&
    (estimatedUnitPrice ?? "").trim() !== "" &&
    parseLocalizedNumber(quantity, userSettings) !== null &&
    parseLocalizedNumber(estimatedUnitPrice, userSettings) !== null;

  const handleParseResult = (result) => {
    const items = result?.multiItems;
    if (!Array.isArray(items) || items.length === 0) return;
    const first = items[0];
    if (first.publisherName) setValue("publisherName", first.publisherName, { shouldDirty: true });
    if (first.softwareDescription) setValue("softwareDescription", first.softwareDescription, { shouldDirty: true });
    if (first.licenseType) setValue("licenseType", first.licenseType, { shouldDirty: true });
    if (first.quantity != null) {
      const value = String(first.quantity);
      setValue("quantity", value, { shouldDirty: true });
      setDisplayQuantity(formatQuantity(value, userSettings) || value);
    }
    if (first.estimatedUnitPrice != null) {
      const uv = String(first.estimatedUnitPrice);
      setValue("estimatedUnitPrice", uv, { shouldDirty: true });
      setDisplayUnitPrice(formatPriceInput(uv, locale));
    }
    if (first.estimatedTotalPrice != null) {
      const tv = String(first.estimatedTotalPrice);
      setValue("estimatedTotalPrice", tv, { shouldDirty: true });
      setDisplayTotalPrice(formatPriceInput(tv, locale));
      setTotalManuallyEdited(true);
    }
    if (first.currency) setValue("currency", first.currency, { shouldDirty: true });
    if (first.startDate) setValue("startDate", first.startDate, { shouldDirty: true });
    if (first.endDate) setValue("endDate", first.endDate, { shouldDirty: true });
    if (first.supplier) setValue("supplier", first.supplier, { shouldDirty: true });
    if (first.contactEmail) setValue("contactEmail", first.contactEmail, { shouldDirty: true });
    if (first.notes) setValue("notes", first.notes, { shouldDirty: true });
    if (items.length > 1) {
      setAdditionalLines(
        items.slice(1).map((it) => ({
          ...emptyAdditionalLine(),
          id: `${Date.now()}-${Math.random()}`,
          publisherName: it.publisherName ?? "",
          softwareDescription: it.softwareDescription ?? "",
          licenseType: it.licenseType ?? "",
          quantity: it.quantity != null ? String(it.quantity) : "",
          estimatedUnitPrice: it.estimatedUnitPrice != null ? String(it.estimatedUnitPrice) : "",
          estimatedTotalPrice: it.estimatedTotalPrice != null ? String(it.estimatedTotalPrice) : "",
          currency: it.currency ?? "EUR",
        }))
      );
    }
  };

  const onSubmit = async (data) => {
    const validTargets = ["primary", ...additionalLines.map((line) => String(line.id))];
    if (attachments.some((attachment) => attachment.scope === "license" && !validTargets.includes(String(attachment.targetKey)))) {
      setAttachmentError("Choose an available license line for each Single document, or remove the document before saving.");
      return;
    }
    setAttachmentError(null);
    setSaving(true);
    try {
      // Parent-create flows use a line collection plus an optional document so
      // single and multi-line submissions share one payload shape.
      // Edit / add-to-existing-request modes (no upload field) use the plain payload.
      if (isNewLineCollection) {
        const primaryItem = sourcingPrimaryFormToPayload(data, customFieldDefs, userSettings);
        const saved = await onSave({
          items: [
            primaryItem,
            ...additionalLines.map((line) => sourcingAdditionalLineToPayload(
              { ...line, parentItemIndex: line.parentLineId
                ? (additionalLines.findIndex((candidate) => candidate.id === line.parentLineId) + 1) || null
                : line.parentItemIndex }, customFieldDefs, userSettings,
            )),
          ],
          supplier: data.supplier || null,
          contactEmail: data.contactEmail || null,
          notes: data.notes || null,
          attachments, attachmentTargetKeys: ["primary", ...additionalLines.map((line) => String(line.id))],
        });
        if (saved) {
          reset();
          setAdditionalLines([]);
          clearAttachments();
        }
      } else {
        const maintenanceCompanion = additionalLines.find((line) => line.isMaintenanceCompanion);
        const saved = await onSave({
          ...sourcingEditFormToPayload(data, customFieldDefs, userSettings),
          attachments, attachmentTargetKeys: ["primary", ...additionalLines.map((line) => String(line.id))],
          ...(maintenanceCompanion ? {
            maintenanceCompanion: maintenanceCompanionToPayload(
              maintenanceCompanion, item?.id, userSettings,
            ),
          } : {}),
        });
        if (saved) reset();
      }
    } finally {
      setSaving(false);
    }
  };

  const lineCount = 1 + additionalLines.length;
  const customFields = (section) => (
    <CustomFieldPlacement definitions={customFieldDefs} values={currentFields.customFieldValues || {}}
      onChange={(values) => setValue("customFieldValues", values, { shouldDirty: true })}
      idPrefix="si" loading={customFieldsLoading} section={section} />
  );

  return (
    <>
      <ModalShell
        title={title ?? (item ? "Edit Sourcing Item" : "Add Sourcing Item")}
        sectionControls
        titleId="dialog-title-sourcing-item"
        onClose={requestClose}
        modalClassName={`modal document-assisted-modal procurement-document-modal${documentPreviewVisible ? " has-document-preview" : ""}`}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!canSave || saving} onClick={handleSubmit(onSubmit)}>
              {saving ? "Saving..." : lineCount > 1 ? `Save ${lineCount} lines` : "Save"}
            </button>
          </>
        )}
      >
        <div className="license-intake-modal-layout">
          <div className="modal-bd document-assisted-modal-form">
          <div className="license-form-stack">
            <LicenseIdentityFormSection idPrefix="si" control={control} register={register} errors={errors}
              fieldIds={{ softwareDescription: "software-desc", licenseType: "license-type" }}>
              {customFields("identity")}
            </LicenseIdentityFormSection>
            <CustomFieldFormSection title="Documents" icon="upload" section="documents"
              definitions={customFieldDefs} values={currentFields.customFieldValues || {}}
              onChange={(values) => setValue("customFieldValues", values, { shouldDirty: true })}
              idPrefix="si" loading={customFieldsLoading} />

            {isNewSourcingRequest && (
              <div className="plugin-slot-form-row" style={slotHasActions ? undefined : { display: "none" }}>
                <PluginSlot
                  slot="sourcing.quote.add.actions"
                  context={{
                    targetType: "sourcing_quote_draft",
                    targetId: "new",
                    ...(attachedFileBase64 ? {
                      fileContentBase64: attachedFileBase64,
                      fileName: attachedFile?.name,
                      contentType: attachedFile?.type || "application/pdf",
                    } : {}),
                  }}
                  onActionsLoaded={(count) => setSlotHasActions(count > 0)}
                  onResult={handleParseResult}
                />
              </div>
            )}

            <LicenseDatesContractFormSection idPrefix="si" register={register}
              fieldIds={{ startDate: "start-date", endDate: "end-date", noticeDate: "notice-date", contractNumber: "contract-number" }}>
              {customFields("dates")}
            </LicenseDatesContractFormSection>

            {supportsMaintenanceCoverage(licenseType) && (
              <LicenseFormSection title="Maintenance / Support">
                <MaintenanceCoverageFields idPrefix="si" licenseType={licenseType} coverage={maintenanceCoverage} startDate={maintenanceStartDate} endDate={maintenanceEndDate} pricingBasis={maintenancePricingBasis} supportQuantity={maintenanceQuantity} supportUnitPrice={maintenanceUnitPrice} cost={maintenanceCost} licenseQuantity={quantity} licenseStartDate={startDate} licenseEndDate={endDate} licenseTotalCost={estimatedTotalPrice} currency={watch("currency")} locale={locale} onChange={(field, value) => setValue(field, value, { shouldDirty: true })} onAddSeparate={addMaintenanceLine} separateLineAdded={maintenanceLineAdded} embedded />
                {customFields("maintenance")}
              </LicenseFormSection>
            )}

            <LicenseFormSection title="Details">
              <div className="fr">
                <div className="fg">
                  <label htmlFor="si-quantity">Purchase Quantity</label>
                  <Controller name="quantity" control={control} render={({ field }) => <input id="si-quantity" className="fi" inputMode="decimal" placeholder="e.g. 25" value={displayQuantity} onChange={(event) => { const raw = event.target.value; const canonical = canonicalizeQuantityInput(raw, userSettings); setDisplayQuantity(raw); field.onChange(canonical ?? raw); }} onBlur={() => { const canonical = canonicalizeQuantityInput(field.value, userSettings); if (canonical != null) { field.onChange(canonical); setDisplayQuantity(formatQuantity(canonical, userSettings)); } field.onBlur(); }} />} />
                </div>
                <div className="fg"><label htmlFor="si-quantity-per-unit">Quantity per Unit</label><input id="si-quantity-per-unit" className="fi" inputMode="decimal" {...register("quantityPerUnit")} /></div>
                <div className="fg"><label htmlFor="si-sku-code">SKU Code</label><input id="si-sku-code" className="fi" {...register("skuCode")} /></div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor="si-license-metric">License Metric</label><select id="si-license-metric" className="fi fi-select" {...register("licenseMetric")}>{LICENSE_METRICS.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></div>
                <div className="fg"><label htmlFor="si-currency">Currency</label><select id="si-currency" className="fi fi-select" {...register("currency")}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
              {!isFreewareLicenseType(licenseType) && (
                <div className="fr">
                  <div className="fg"><label htmlFor="si-unit-price">Est. Unit Price <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400 }}>(excl. tax)</span></label><Controller name="estimatedUnitPrice" control={control} render={({ field }) => <input id="si-unit-price" className="fi" value={displayUnitPrice} onFocus={() => setDisplayUnitPrice(field.value)} onChange={(e) => { const raw = parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value; setDisplayUnitPrice(e.target.value); field.onChange(raw); }} onBlur={() => { setDisplayUnitPrice(formatPriceInput(field.value, locale)); field.onBlur(); }} placeholder={`e.g. ${formatPriceInput("15.00", locale)}`} />} /></div>
                  <div className="fg"><label htmlFor="si-total-price">Est. Line Total {showAutoLabel && <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400 }}>(auto)</span>}</label><Controller name="estimatedTotalPrice" control={control} render={({ field }) => <input id="si-total-price" className="fi" value={displayTotalPrice} onFocus={() => setDisplayTotalPrice(field.value)} onChange={(e) => { const raw = parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value; setTotalManuallyEdited(true); setDisplayTotalPrice(e.target.value); field.onChange(raw); }} onBlur={() => { setDisplayTotalPrice(formatPriceInput(field.value, locale)); field.onBlur(); }} placeholder={`e.g. ${formatPriceInput("4500.00", locale)}`} />} /><LineTotalMismatchHint quantity={quantity} unitPrice={estimatedUnitPrice} total={estimatedTotalPrice} currency={watch("currency")} settings={userSettings} /></div>
                </div>
              )}
              {licenseType === "saas" && <div className="fg"><label htmlFor="si-portal-url">Portal URL</label><input id="si-portal-url" className="fi" {...register("portalUrl")} /></div>}
              {customFields("commercial")}
            </LicenseFormSection>

            <LicenseFormSection title="Relationships">
              <div className="fr">
                <div className="fg">
                  <label htmlFor="si-supplier">{pendingOrderId ? "Order supplier" : "Request supplier"}</label>
                  <Controller name="supplier" control={control} render={({ field }) => <ReferenceCombobox id="si-supplier" mode="supplier" placeholder="Reseller or direct supplier" {...field} onChange={(value) => { const previousSupplier = watch("supplier"); field.onChange(value); if (String(previousSupplier || "").trim().toLocaleLowerCase() !== value.trim().toLocaleLowerCase()) setValue("contactEmail", "", { shouldDirty: true }); }} />} />
                  <span className="field-hint">Applies to every line in this {pendingOrderId ? "pending order" : "sourcing request"}.</span>
                </div>
                <div className="fg"><label htmlFor="si-contact-email">Supplier Contact</label><input id="si-contact-email" className="fi" type="email" placeholder="contact@example.com" {...register("contactEmail")} />{errors.contactEmail ? <span className="field-error">{errors.contactEmail.message}</span> : <span className="field-hint">{SUPPLIER_CONTACT_HELP}</span>}</div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor="si-cost-centre">Cost Centre</label><Controller name="costCentre" control={control} render={({ field }) => <ReferenceCombobox id="si-cost-centre" mode="costCentre" {...field} />} /></div>
                <div className="fg"><label htmlFor="si-budget-owner">Budget Owner Email</label><Controller name="budgetOwnerEmail" control={control} render={({ field }) => <ContactCombobox id="si-budget-owner" {...field} />} /></div>
              </div>
              <div className="fg"><label htmlFor="si-secondary-contacts">Secondary Contacts</label><Controller name="secondaryContacts" control={control} render={({ field }) => <ContactCombobox id="si-secondary-contacts" multiple placeholder="Separate email addresses with commas" {...field} />} /></div>
              {customFields("people")}
            </LicenseFormSection>

            <LicenseFormSection title="Notes">
              <div className="fg"><label htmlFor="si-notes">Notes</label><textarea id="si-notes" className="fi" rows={3} placeholder="Procurement notes" style={{ resize: "vertical" }} {...register("notes")} /></div>
              {customFields("notes")}
            </LicenseFormSection>

            <CustomFieldFormSection title="Custom Fields" section="__catchall__"
              definitions={customFieldDefs} values={currentFields.customFieldValues || {}}
              onChange={(values) => setValue("customFieldValues", values, { shouldDirty: true })}
              idPrefix="si" loading={customFieldsLoading} />
          </div>

          {/* Additional lines (new-request mode only) */}
          {additionalLines.map((line, idx) => (
            <div key={line.id} style={{ borderTop: "1px solid var(--border-lt)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Line {idx + 2}</span>
                <button
                  type="button"
                  className="btn btn-g"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => removeAdditionalLine(line.id)}
                >
                  <Icon name="x" size={12} /> Remove
                </button>
              </div>
              <div className="license-form-stack license-line-item-sections">
                <LicenseFormSection title="Identity">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-publisher`}>Publisher <span className="field-required">*</span></label><ReferenceCombobox id={`sourcing-line-${line.id}-publisher`} mode="publisher" value={line.publisherName} onChange={(value) => updateAdditionalLine(line.id, "publisherName", value)} placeholder="Software publisher" /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-software`}>Software Description <span className="field-required">*</span></label><input id={`sourcing-line-${line.id}-software`} className="fi" value={line.softwareDescription} onChange={(event) => updateAdditionalLine(line.id, "softwareDescription", event.target.value)} placeholder="Product or service name" /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-license-type`}>License Type (optional)</label><select id={`sourcing-line-${line.id}-license-type`} className="fi fi-select" value={line.licenseType} onChange={(event) => {
                    const nextType = event.target.value;
                    updateAdditionalLine(line.id, "licenseType", nextType);
                    if (!supportsSeparateMaintenanceLine(nextType)) {
                      setAdditionalLines((prev) => prev.filter((candidate) => candidate.parentLineId !== line.id));
                    }
                    if (isFreewareLicenseType(nextType)) {
                      updateAdditionalLine(line.id, "estimatedUnitPrice", "");
                      updateAdditionalLine(line.id, "estimatedTotalPrice", "");
                    }
                  }}><option value="">Not specified</option>{LICENSE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
                  <LicenseTypeOptInFields idPrefix={`sourcing-line-${line.id}`} licenseType={line.licenseType} isRenewable={line.isRenewable} typeDescription={line.typeDescription} onChange={(field, value) => updateAdditionalLine(line.id, field, value)} error={typeDescriptionMissing(line.licenseType, line.typeDescription) ? TYPE_DESCRIPTION_REQUIRED_MESSAGE : null} />
                  <CustomFieldPlacement definitions={customFieldDefs} values={line.customFieldValues || {}} onChange={(values) => updateAdditionalLine(line.id, "customFieldValues", values)} idPrefix={`sourcing-line-${line.id}`} loading={customFieldsLoading} section="identity" />
                </LicenseFormSection>
                <CustomFieldFormSection title="Documents" section="documents" definitions={customFieldDefs} values={line.customFieldValues || {}} onChange={(values) => updateAdditionalLine(line.id, "customFieldValues", values)} idPrefix={`sourcing-line-${line.id}`} loading={customFieldsLoading} />
                <LicenseDraftSupplementFields
                  item={line}
                  onChange={(field, value) => updateAdditionalLine(line.id, field, value)}
                  idPrefix={`sourcing-line-${line.id}`}
                  customFieldDefs={customFieldDefs}
                  customFieldsLoading={customFieldsLoading}
                  sectioned
                  showLicenseType={false}
                  showCoreDetails={false}
                  commercialSummary={<>
                    <div className="fr">
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-quantity`}>Purchase Quantity</label><input id={`sourcing-line-${line.id}-quantity`} className="fi" inputMode="decimal" value={line.quantity} onChange={(event) => updateAdditionalLine(line.id, "quantity", event.target.value)} placeholder="e.g. 10" /></div>
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-quantity-per-unit`}>Quantity per Unit</label><input id={`sourcing-line-${line.id}-quantity-per-unit`} className="fi" inputMode="decimal" value={line.quantityPerUnit} onChange={(event) => updateAdditionalLine(line.id, "quantityPerUnit", event.target.value)} /></div>
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-sku`}>SKU Code</label><input id={`sourcing-line-${line.id}-sku`} className="fi" value={line.skuCode} onChange={(event) => updateAdditionalLine(line.id, "skuCode", event.target.value)} /></div>
                    </div>
                    <div className="fr">
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-metric`}>License Metric</label><select id={`sourcing-line-${line.id}-metric`} className="fi fi-select" value={line.licenseMetric} onChange={(event) => updateAdditionalLine(line.id, "licenseMetric", event.target.value)}>{LICENSE_METRICS.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></div>
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-currency`}>Currency</label><select id={`sourcing-line-${line.id}-currency`} className="fi fi-select" value={line.currency} onChange={(event) => updateAdditionalLine(line.id, "currency", event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div>
                    </div>
                    {!isFreewareLicenseType(line.licenseType) && <div className="fr">
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-unit-price`}>Est. Unit Price</label><input id={`sourcing-line-${line.id}-unit-price`} className="fi" inputMode="decimal" value={line.estimatedUnitPrice} onChange={(event) => updateAdditionalLine(line.id, "estimatedUnitPrice", event.target.value)} placeholder="Unit price" /></div>
                      <div className="fg"><label htmlFor={`sourcing-line-${line.id}-total-price`}>Est. Line Total</label><input id={`sourcing-line-${line.id}-total-price`} className="fi" inputMode="decimal" value={line.estimatedTotalPrice} onChange={(event) => updateAdditionalLine(line.id, "estimatedTotalPrice", event.target.value)} placeholder="Total price" /><LineTotalMismatchHint quantity={line.quantity} unitPrice={line.estimatedUnitPrice} total={line.estimatedTotalPrice} currency={line.currency} settings={userSettings} /></div>
                    </div>}
                    {line.licenseType === "saas" && <div className="fg"><label htmlFor={`sourcing-line-${line.id}-portal`}>Portal URL</label><input id={`sourcing-line-${line.id}-portal`} className="fi" value={line.portalUrl} onChange={(event) => updateAdditionalLine(line.id, "portalUrl", event.target.value)} /></div>}
                  </>}
                  maintenanceSection={supportsMaintenanceCoverage(line.licenseType) ? <LicenseFormSection title="Maintenance / Support">
                    <MaintenanceCoverageFields idPrefix={`sourcing-line-${line.id}`} licenseType={line.licenseType} coverage={line.maintenanceCoverage} startDate={line.maintenanceStartDate} endDate={line.maintenanceEndDate} pricingBasis={line.maintenancePricingBasis} supportQuantity={line.maintenanceQuantity} supportUnitPrice={line.maintenanceUnitPrice} cost={line.maintenanceCost} licenseQuantity={line.quantity} licenseStartDate={line.startDate} licenseEndDate={line.endDate} licenseTotalCost={line.estimatedTotalPrice} currency={line.currency} locale={locale} onChange={(field, value) => updateAdditionalLine(line.id, field, value)} onAddSeparate={() => addAdditionalMaintenanceLine(line)} separateLineAdded={hasAdditionalMaintenanceLine(line.id)} embedded />
                    <CustomFieldPlacement definitions={customFieldDefs} values={line.customFieldValues || {}} onChange={(values) => updateAdditionalLine(line.id, "customFieldValues", values)} idPrefix={`sourcing-line-${line.id}`} loading={customFieldsLoading} section="maintenance" />
                  </LicenseFormSection> : null}
                />
                {line.isMaintenanceCompanion && <LicenseFormSection title="Supplier">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-supplier`}>Supplier</label><ReferenceCombobox id={`sourcing-line-${line.id}-supplier`} mode="supplier" value={line.supplier} onChange={(value) => updateAdditionalLine(line.id, "supplier", value)} placeholder="Same supplier or a support provider" /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-contact`}>Supplier Contact</label><input id={`sourcing-line-${line.id}-contact`} className="fi" value={line.contactEmail} onChange={(event) => updateAdditionalLine(line.id, "contactEmail", event.target.value)} placeholder="support@example.com" /></div>
                </LicenseFormSection>}
              </div>
            </div>
          ))}

          {isNewLineCollection && (
            <button
              type="button"
              className="btn btn-g"
              style={{ marginTop: 12, fontSize: 12, alignSelf: "flex-start" }}
              onClick={addAdditionalLine}
            >
              <Icon name="plus" size={12} /> Add additional license line
            </button>
          )}

          {/* Edit-mode plugin slot */}
          {item?.id && (
            <div className="plugin-slot-form-row">
              <PluginSlot
                slot={pluginSlot}
                context={{
                  targetType: pluginTargetType,
                  targetId: item.id,
                  sourcingRequestId,
                  pendingOrderId,
                  itemFields: currentFields,
                  lineFields: currentFields,
                }}
              />
            </div>
          )}
          {item?.id && (onAddNextTerm || onEditPredecessors) && (
            <section className="sourcing-term-actions" aria-label="Term succession">
              <h3>Term succession</h3>
              <TermLinkContext item={item} items={termItems} />
              <p>These links use the saved line. Save edits first, or discard them when prompted.</p>
              <div className="sourcing-term-actions-buttons">
                {onAddNextTerm && (
                  <button type="button" className="btn btn-g" disabled={saving} onClick={() => requestTermAction("add")}>Set next term</button>
                )}
                {onEditPredecessors && (
                  <button type="button" className="btn btn-g" disabled={saving} onClick={() => requestTermAction("link")}>Set predecessors</button>
                )}
              </div>
            </section>
          )}
        </div>
          {attachmentError && <p className="field-error" role="alert">{attachmentError}</p>}
          <DocumentStagingWorkspace
            attachments={attachments}
            categoryScopes={categoryScopes}
            documents={documents.map((document) => ({ ...document, category: document.category ?? (pendingOrderId ? "purchase_order" : "quote"), sourceLabel: document.sourceLabel ?? ((document.targetSourcingItemId ?? document.target_sourcing_item_id) != null || document.scope === "license" ? "Attached to one license line" : "Shared purchase document") }))}
            inputIdPrefix="sourcing-attachment"
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
            onTargetChange={changeTarget}
            onCategoryScopeChange={changeCategoryScope}
            previewDocument={pendingOrderId ? previewConversionDocument : previewSourcingQuoteDocument}
            downloadDocument={pendingOrderId ? downloadConversionDocument : (document) => downloadSourcingQuoteDocument(document.id, document.originalFilename ?? document.original_filename)}
            onDeleteDocument={onDeleteDocument}
            targetOptions={[{ value: "primary", label: softwareVal || "Line 1" }, ...additionalLines.map((line, index) => ({ value: String(line.id), label: line.softwareDescription || `Line ${index + 2}` }))]}
            userSettings={userSettings}
            defaultOpen
            onPreviewVisibilityChange={setDocumentPreviewVisible}
          />
        </div>
      </ModalShell>
      {showDiscardDialog && (
        <DiscardChangesDialog
          onDiscard={() => {
            const action = pendingTermAction;
            reset();
            setPendingTermAction(null);
            setShowDiscardDialog(false);
            if (action === "add") onAddNextTerm?.();
            else if (action === "link") onEditPredecessors?.();
            else onCancel();
          }}
          onKeep={() => { setPendingTermAction(null); setShowDiscardDialog(false); }}
        />
      )}
    </>
  );
};

export default SourcingItemModal;

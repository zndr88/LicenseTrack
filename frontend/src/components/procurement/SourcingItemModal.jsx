import React, { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CURRENCIES, LICENSE_METRICS, LICENSE_TYPES } from "../../constants/licenseData.js";
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
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import PluginSlot from "../plugins/PluginSlot.jsx";
import MaintenanceCoverageFields, {
  isFreewareLicenseType,
  supportsMaintenanceCoverage,
  supportsSeparateMaintenanceLine,
} from "./MaintenanceCoverageFields.jsx";
import { defaultMaintenanceCoverageForLicenseType } from "../../utils/maintenanceCoverage.js";
import CustomFieldFormFields from "../licenses/CustomFieldFormFields.jsx";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { buildCustomFieldValuePayload, customFieldValueMap } from "../../utils/customFieldFormValues.js";

const schema = z.object({
  publisherName:       z.string().min(1, "Publisher is required."),
  softwareDescription: z.string().min(1, "Software description is required."),
  licenseType:         z.string(),
  licenseMetric:       z.string(),
  portalUrl:           z.string(),
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
});

// Compute total from qty x unit, falling back to the supplied total value.
const computeInitialTotal = (itemData) => {
  if (!itemData) return "";
  const qty = parseFloat(itemData.quantity ?? "");
  const unit = parseFloat(itemData.estimatedUnitPrice ?? "");
  if (!isNaN(qty) && !isNaN(unit) && qty > 0 && unit > 0) return (qty * unit).toFixed(2);
  return itemData.estimatedTotalPrice ?? "";
};

const emptyAdditionalLine = (overrides = {}) => ({
  id: `${Date.now()}-${Math.random()}`,
  publisherName: "",
  softwareDescription: "",
  licenseType: "",
  licenseMetric: "per_user",
  portalUrl: "",
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
  isMaintenanceCompanion: false,
  ...overrides,
});

function normalizeOptionalNumber(value, settings) {
  return (parseLocalizedNumber(value, settings) ?? value) || null;
}

const SourcingItemModal = ({
  item,
  requestId,
  sourcingRequest,
  userSettings,
  title,
  onSave,
  onCancel,
}) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();
  const pendingOrderId = item?.pendingOrderId ?? item?.pending_order_id ?? null;
  const sourcingRequestId = item?.sourcingRequestId
    ?? item?.sourcing_request_id
    ?? sourcingRequest?.id
    ?? null;
  const effectiveSupplier = item?.supplier || sourcingRequest?.supplier || "";
  const effectiveContactEmail = item?.contactEmail || sourcingRequest?.contactEmail || "";
  const pluginSlot = pendingOrderId ? "pendingOrder.line.edit.actions" : "sourcing.item.edit.actions";
  const pluginTargetType = pendingOrderId ? "pending_order_item" : "sourcing_item";

  // "new request" mode: add mode with no parent request - supports multi-line and quote parse
  const isNewRequest = !item?.id && !requestId;

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
    defaultValues: {
      publisherName:       item?.publisherName ?? "",
      softwareDescription: item?.softwareDescription ?? "",
      licenseType:         item?.licenseType ?? "",
      licenseMetric:       item?.licenseMetric ?? "per_user",
      portalUrl:           item?.portalUrl ?? "",
      maintenanceCoverage: item?.maintenanceCoverage
        ?? (item?.isRenewal || item?.renewalForLicenseId != null
          ? defaultMaintenanceCoverageForLicenseType(item?.licenseType)
          : "unknown"),
      maintenanceStartDate: item?.maintenanceStartDate ?? "",
      maintenanceEndDate:  item?.maintenanceEndDate ?? "",
      maintenancePricingBasis: item?.maintenancePricingBasis ?? "flat",
      maintenanceQuantity: item?.maintenanceQuantity ?? "",
      maintenanceUnitPrice: item?.maintenanceUnitPrice ?? "",
      maintenanceCost:     item?.maintenanceCost ?? "",
      quantity:            item?.quantity ?? "",
      quantityPerUnit:     item?.quantityPerUnit ?? "1",
      skuCode:             item?.skuCode ?? "",
      estimatedUnitPrice:  item?.estimatedUnitPrice ?? "",
      estimatedTotalPrice: computeInitialTotal(item),
      currency:            item?.currency ?? "EUR",
      startDate:           item?.startDate ?? "",
      endDate:             item?.endDate ?? "",
      noticeDate:          item?.noticeDate ?? "",
      purchaseDate:        item?.purchaseDate ?? "",
      contractNumber:      item?.contractNumber ?? "",
      invoiceNumber:       item?.invoiceNumber ?? "",
      externalRef:         item?.externalRef ?? "",
      costCentre:          item?.costCentre ?? "",
      budgetOwnerEmail:    item?.budgetOwnerEmail ?? "",
      secondaryContacts:   (item?.secondaryContacts ?? []).join(", "),
      customFieldValues:   customFieldValueMap(item?.customFieldValues),
      supplier:            effectiveSupplier,
      contactEmail:        effectiveContactEmail,
      notes:               item?.notes ?? "",
    },
  });

  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [slotHasActions, setSlotHasActions] = useState(false);
  const [additionalLines, setAdditionalLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const handleFileChange = (file) => {
    setAttachedFile(file);
    if (!file) { setAttachedFileBase64(null); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachedFileBase64(reader.result.split(",")[1] ?? null);
    reader.readAsDataURL(file);
  };

  const addAdditionalLine = () => setAdditionalLines((prev) => [...prev, emptyAdditionalLine()]);
  const removeAdditionalLine = (id) => setAdditionalLines((prev) => prev.filter((l) => l.id !== id));
  const updateAdditionalLine = (id, field, value) =>
    setAdditionalLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);
  const [displayQuantity, setDisplayQuantity] = useState(
    formatQuantity(item?.quantity, userSettings) || item?.quantity || ""
  );
  const [displayUnitPrice, setDisplayUnitPrice] = useState(
    formatPriceInput(item?.estimatedUnitPrice ?? "", locale)
  );
  const [displayTotalPrice, setDisplayTotalPrice] = useState(
    formatPriceInput(computeInitialTotal(item), locale)
  );

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: isDirty || !!attachedFile,
    onClose: onCancel,
  });

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
  }, [licenseType]);

  const publisherVal = watch("publisherName");
  const softwareVal = watch("softwareDescription");
  const currentFields = watch();
  const additionalLinesValid = additionalLines.every(
    (l) => (l.publisherName ?? "").trim() !== "" && (l.softwareDescription ?? "").trim() !== ""
  );
  const maintenanceLineAdded = additionalLines.some((line) => line.isMaintenanceCompanion);
  const addMaintenanceLine = () => {
    if (maintenanceLineAdded) return;
    setAdditionalLines((prev) => [
      ...prev,
      emptyAdditionalLine({
        publisherName: publisherVal || "",
        softwareDescription: `${softwareVal || "Software"} maintenance/support`,
        licenseType: "maintenance",
        quantity: quantity || "1",
        currency: watch("currency") || "EUR",
        startDate: maintenanceStartDate || watch("startDate") || "",
        endDate: maintenanceEndDate || watch("endDate") || "",
        supplier: watch("supplier") || "",
        contactEmail: watch("contactEmail") || "",
        parentItemIndex: 0,
        isMaintenanceCompanion: true,
      }),
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
    setSaving(true);
    try {
      // New requests always go through the request-create path (items + optional
      // quoteFile), so an attached quote is uploaded even for a single line.
      // Edit / add-to-existing-request modes (no upload field) use the plain payload.
      if (isNewRequest) {
        const primaryItem = {
          publisherName: data.publisherName,
          softwareDescription: data.softwareDescription,
          licenseType: data.licenseType || null,
          licenseMetric: data.licenseMetric || null,
          portalUrl: data.licenseType === "saas" ? data.portalUrl || null : null,
          maintenanceCoverage: supportsMaintenanceCoverage(data.licenseType)
            ? (data.maintenanceCoverage || "unknown")
            : null,
          maintenanceStartDate: data.maintenanceCoverage === "included"
            ? (data.maintenanceStartDate || null)
            : null,
          maintenanceEndDate: data.maintenanceCoverage === "included"
            ? (data.maintenanceEndDate || null)
            : null,
          maintenancePricingBasis: data.maintenanceCoverage === "included"
            ? (data.maintenancePricingBasis || "flat")
            : null,
          maintenanceQuantity: data.maintenanceCoverage === "included"
            ? normalizeOptionalNumber(data.maintenanceQuantity, userSettings)
            : null,
          maintenanceUnitPrice: data.maintenanceCoverage === "included"
            ? normalizeOptionalNumber(data.maintenanceUnitPrice, userSettings)
            : null,
          maintenanceCost: data.maintenanceCoverage === "included"
            ? normalizeOptionalNumber(data.maintenanceCost, userSettings)
            : null,
          quantity: (parseLocalizedNumber(data.quantity, userSettings) ?? data.quantity) || null,
          quantityPerUnit: normalizeOptionalNumber(data.quantityPerUnit, userSettings) || "1",
          skuCode: data.skuCode || null,
          estimatedUnitPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : (parseLocalizedNumber(data.estimatedUnitPrice, userSettings) ?? data.estimatedUnitPrice) || null,
          estimatedTotalPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : (parseLocalizedNumber(data.estimatedTotalPrice, userSettings) ?? data.estimatedTotalPrice) || null,
          currency: data.currency || "EUR",
          startDate: data.startDate || null,
          endDate: data.endDate || null,
          noticeDate: data.noticeDate || null,
          purchaseDate: data.purchaseDate || null,
          contractNumber: data.contractNumber || null,
          invoiceNumber: data.invoiceNumber || null,
          externalRef: data.externalRef || null,
          costCentre: data.costCentre || null,
          budgetOwnerEmail: data.budgetOwnerEmail || null,
          secondaryContacts: String(data.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
          customFieldValues: buildCustomFieldValuePayload(customFieldDefs, data.customFieldValues, userSettings),
        };
        const saved = await onSave({
          items: [
            primaryItem,
            ...additionalLines.map((l) => ({
              publisherName: l.publisherName,
              softwareDescription: l.softwareDescription,
              licenseType: l.licenseType || null,
              licenseMetric: l.licenseMetric || null,
              portalUrl: l.licenseType === "saas" ? l.portalUrl || null : null,
              quantity: normalizeOptionalNumber(l.quantity, userSettings),
              quantityPerUnit: normalizeOptionalNumber(l.quantityPerUnit, userSettings) || "1",
              skuCode: l.skuCode || null,
              estimatedUnitPrice: normalizeOptionalNumber(l.estimatedUnitPrice, userSettings),
              estimatedTotalPrice: normalizeOptionalNumber(l.estimatedTotalPrice, userSettings),
              currency: l.currency || "EUR",
              startDate: l.startDate || null,
              endDate: l.endDate || null,
              noticeDate: l.noticeDate || null,
              purchaseDate: l.purchaseDate || null,
              contractNumber: l.contractNumber || null,
              invoiceNumber: l.invoiceNumber || null,
              externalRef: l.externalRef || null,
              costCentre: l.costCentre || null,
              budgetOwnerEmail: l.budgetOwnerEmail || null,
              secondaryContacts: String(l.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
              customFieldValues: buildCustomFieldValuePayload(customFieldDefs, l.customFieldValues, userSettings),
              supplier: l.supplier || null,
              contactEmail: l.contactEmail || null,
              notes: l.notes || null,
              parentItemIndex: l.parentItemIndex,
            })),
          ],
          supplier: data.supplier || null,
          contactEmail: data.contactEmail || null,
          notes: data.notes || null,
          quoteFile: attachedFile || null,
        });
        if (saved) {
          reset();
          setAdditionalLines([]);
          handleFileChange(null);
        }
      } else {
        const maintenanceCompanion = additionalLines.find((line) => line.isMaintenanceCompanion);
        const saved = await onSave({
          ...data,
          customFieldValues: buildCustomFieldValuePayload(customFieldDefs, data.customFieldValues, userSettings),
          secondaryContacts: String(data.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
          quantity: parseLocalizedNumber(data.quantity, userSettings) ?? data.quantity,
          estimatedUnitPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : parseLocalizedNumber(data.estimatedUnitPrice, userSettings) ?? data.estimatedUnitPrice,
          estimatedTotalPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : parseLocalizedNumber(data.estimatedTotalPrice, userSettings) ?? data.estimatedTotalPrice,
          maintenanceQuantity: normalizeOptionalNumber(data.maintenanceQuantity, userSettings),
          maintenanceUnitPrice: normalizeOptionalNumber(data.maintenanceUnitPrice, userSettings),
          maintenanceCost: normalizeOptionalNumber(data.maintenanceCost, userSettings),
          ...(maintenanceCompanion ? {
            maintenanceCompanion: {
              publisherName: maintenanceCompanion.publisherName,
              softwareDescription: maintenanceCompanion.softwareDescription,
              licenseType: "maintenance",
              quantity: normalizeOptionalNumber(maintenanceCompanion.quantity, userSettings),
              estimatedUnitPrice: normalizeOptionalNumber(maintenanceCompanion.estimatedUnitPrice, userSettings),
              estimatedTotalPrice: normalizeOptionalNumber(maintenanceCompanion.estimatedTotalPrice, userSettings),
              currency: maintenanceCompanion.currency || "EUR",
              startDate: maintenanceCompanion.startDate || null,
              endDate: maintenanceCompanion.endDate || null,
              supplier: maintenanceCompanion.supplier || null,
              contactEmail: maintenanceCompanion.contactEmail || null,
              parentSourcingItemId: item?.id ?? null,
            },
          } : {}),
        });
        if (saved) reset();
      }
    } finally {
      setSaving(false);
    }
  };

  const lineCount = 1 + additionalLines.length;
  const showQuotePreview = Boolean(attachedFile);

  return (
    <>
      <ModalShell
        title={title ?? (item ? "Edit Sourcing Item" : "Add Sourcing Item")}
        titleId="dialog-title-sourcing-item"
        onClose={requestClose}
        modalClassName="modal document-assisted-modal"
        modalStyle={{
          width: showQuotePreview ? "min(1120px, 94vw)" : "min(560px, 92vw)",
          maxWidth: showQuotePreview ? "min(1120px, 94vw)" : "min(560px, 92vw)",
          overflow: "hidden",
        }}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!canSave || saving} onClick={handleSubmit(onSubmit)}>
              {saving ? "Saving..." : lineCount > 1 ? `Save ${lineCount} lines` : "Save"}
            </button>
          </>
        )}
      >
        <div className={`document-assisted-modal-layout${showQuotePreview ? " has-document-preview" : ""}`}>
          <LocalDocumentPreviewPanel
            ariaLabel="Attached quote preview"
            file={attachedFile}
            label="Quote Preview"
          />
          <div className="modal-bd document-assisted-modal-form">
          {/* Quote upload - always available (document attaches to the request).
              Parse Quote action is layered on below when a plugin is active. */}
          {isNewRequest && (
            <>
              <div className="fg" style={{ borderBottom: "1px solid var(--border-lt)", paddingBottom: 12, marginBottom: 4 }}>
                {attachedFile ? (
                  <div className="fg-label">Upload Quote <span style={{ fontWeight: 400, color: "var(--text-3)" }}>{slotHasActions ? "(optional — use Parse Quote to auto-fill)" : "(optional)"}</span></div>
                ) : (
                  <label htmlFor="sourcing-quote-file">Upload Quote <span style={{ fontWeight: 400, color: "var(--text-3)" }}>{slotHasActions ? "(optional — use Parse Quote to auto-fill)" : "(optional)"}</span></label>
                )}
                {attachedFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Icon name="file" size={14} color="var(--text-2)" />
                    <span style={{ fontSize: 12, color: "var(--text-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedFile.name}</span>
                    <button type="button" className="btn btn-g" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => handleFileChange(null)}>Remove</button>
                  </div>
                ) : (
                  <input id="sourcing-quote-file" type="file" className="fi" style={{ marginTop: 4 }} accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
                )}
              </div>
              {/* PluginSlot always mounted to discover actions; hidden via CSS when empty */}
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
            </>
          )}

          {/* Primary line */}
          <div className="fr">
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-publisher">Publisher <span style={{ color: "var(--red)" }}>*</span></label>
              <Controller
                name="publisherName"
                control={control}
                render={({ field }) => (
                  <ReferenceCombobox id="si-publisher" mode="publisher" placeholder="Software publisher" {...field} />
                )}
              />
              {errors.publisherName && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.publisherName.message}</span>}
            </div>
          </div>
          <div className="fg">
            <label htmlFor="si-software-desc">Software Description <span style={{ color: "var(--red)" }}>*</span></label>
            <input id="si-software-desc" className="fi" placeholder="Product or service name" {...register("softwareDescription")} />
            {errors.softwareDescription && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.softwareDescription.message}</span>}
          </div>
          <div className="fg">
            <label htmlFor="si-license-type">
              License Type <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span>
            </label>
            <select id="si-license-type" className="fi fi-select" {...register("licenseType")}>
              <option value="">Not specified</option>
              {LICENSE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <MaintenanceCoverageFields
            idPrefix="si"
            licenseType={licenseType}
            coverage={maintenanceCoverage}
            startDate={maintenanceStartDate}
            endDate={maintenanceEndDate}
            pricingBasis={maintenancePricingBasis}
            supportQuantity={maintenanceQuantity}
            supportUnitPrice={maintenanceUnitPrice}
            cost={maintenanceCost}
            licenseQuantity={quantity}
            licenseStartDate={startDate}
            licenseEndDate={endDate}
            licenseTotalCost={estimatedTotalPrice}
            currency={watch("currency")}
            locale={locale}
            onChange={(field, value) => setValue(field, value, { shouldDirty: true })}
            onAddSeparate={addMaintenanceLine}
            separateLineAdded={maintenanceLineAdded}
          />
          <div className="fr">
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-quantity">Purchase Quantity</label>
              <Controller
                name="quantity"
                control={control}
                render={({ field }) => (
                  <input
                    id="si-quantity"
                    className="fi"
                    inputMode="decimal"
                    placeholder="e.g. 25"
                    value={displayQuantity}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const canonical = canonicalizeQuantityInput(raw, userSettings);
                      setDisplayQuantity(raw);
                      field.onChange(canonical ?? raw);
                    }}
                    onBlur={() => {
                      const canonical = canonicalizeQuantityInput(field.value, userSettings);
                      if (canonical != null) {
                        field.onChange(canonical);
                        setDisplayQuantity(formatQuantity(canonical, userSettings));
                      }
                      field.onBlur();
                    }}
                  />
                )}
              />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-currency">Currency</label>
              <select id="si-currency" className="fi" {...register("currency")}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {!isFreewareLicenseType(licenseType) && (
          <div className="fr">
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-unit-price">Est. Unit Price <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400 }}>(excl. tax)</span></label>
              <Controller
                name="estimatedUnitPrice"
                control={control}
                render={({ field }) => (
                  <input
                    id="si-unit-price"
                    className="fi"
                    value={displayUnitPrice}
                    onFocus={() => setDisplayUnitPrice(field.value)}
                    onChange={(e) => {
                      const raw = parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value;
                      setDisplayUnitPrice(e.target.value);
                      field.onChange(raw);
                    }}
                    onBlur={() => {
                      setDisplayUnitPrice(formatPriceInput(field.value, locale));
                      field.onBlur();
                    }}
                    placeholder={`e.g. ${formatPriceInput("15.00", locale)}`}
                  />
                )}
              />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-total-price">Est. Total Price {showAutoLabel && <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400 }}>(auto)</span>}</label>
              <Controller
                name="estimatedTotalPrice"
                control={control}
                render={({ field }) => (
                  <input
                    id="si-total-price"
                    className="fi"
                    value={displayTotalPrice}
                    onFocus={() => setDisplayTotalPrice(field.value)}
                    onChange={(e) => {
                      const raw = parseLocalizedNumber(e.target.value, userSettings) ?? e.target.value;
                      setTotalManuallyEdited(true);
                      setDisplayTotalPrice(e.target.value);
                      field.onChange(raw);
                    }}
                    onBlur={() => {
                      setDisplayTotalPrice(formatPriceInput(field.value, locale));
                      field.onBlur();
                    }}
                    placeholder={`e.g. ${formatPriceInput("4500.00", locale)}`}
                  />
                )}
              />
            </div>
          </div>
          )}
          <div className="fr">
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-start-date">Start Date</label>
              <input id="si-start-date" className="fi" type="date" {...register("startDate")} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-end-date">End Date</label>
              <input id="si-end-date" className="fi" type="date" {...register("endDate")} />
            </div>
          </div>
          <div className="fr">
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-supplier">Request supplier</label>
              <Controller
                name="supplier"
                control={control}
                render={({ field }) => (
                  <ReferenceCombobox
                    id="si-supplier"
                    mode="supplier"
                    placeholder="Reseller or direct supplier"
                    {...field}
                    onChange={(value) => {
                      const previousSupplier = watch("supplier");
                      field.onChange(value);
                      if (String(previousSupplier || "").trim().toLocaleLowerCase() !== value.trim().toLocaleLowerCase()) {
                        setValue("contactEmail", "", { shouldDirty: true });
                      }
                    }}
                  />
                )}
              />
              <span className="field-hint">Applies to every line in this sourcing request.</span>
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label htmlFor="si-contact-email">Contact Email</label>
              <input id="si-contact-email" className="fi" type="email" placeholder="contact@example.com" {...register("contactEmail")} />
              {errors.contactEmail && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.contactEmail.message}</span>}
            </div>
          </div>
          <div className="fg">
            <label htmlFor="si-notes">Notes</label>
            <textarea id="si-notes" className="fi" rows={3} placeholder="Procurement notes" style={{ resize: "vertical" }} {...register("notes")} />
          </div>
          <fieldset className="fs">
            <legend>License record details</legend>
            <div className="fr">
              <div className="fg"><label htmlFor="si-license-metric">License Metric</label><select id="si-license-metric" className="fi fi-select" {...register("licenseMetric")}>{LICENSE_METRICS.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></div>
              <div className="fg"><label htmlFor="si-quantity-per-unit">Quantity per Unit</label><input id="si-quantity-per-unit" className="fi" inputMode="decimal" {...register("quantityPerUnit")} /></div>
              <div className="fg"><label htmlFor="si-sku-code">SKU Code</label><input id="si-sku-code" className="fi" {...register("skuCode")} /></div>
            </div>
            {licenseType === "saas" && <div className="fg"><label htmlFor="si-portal-url">Portal URL</label><input id="si-portal-url" className="fi" {...register("portalUrl")} /></div>}
            <div className="fr">
              <div className="fg"><label htmlFor="si-notice-date">Notice Date</label><input id="si-notice-date" type="date" className="fi" {...register("noticeDate")} /></div>
              <div className="fg"><label htmlFor="si-purchase-date">Purchase Date</label><input id="si-purchase-date" type="date" className="fi" {...register("purchaseDate")} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label htmlFor="si-contract-number">Contract Number</label><input id="si-contract-number" className="fi" {...register("contractNumber")} /></div>
              <div className="fg"><label htmlFor="si-invoice-number">Invoice Number</label><input id="si-invoice-number" className="fi" {...register("invoiceNumber")} /></div>
              <div className="fg"><label htmlFor="si-external-ref">External Reference</label><input id="si-external-ref" className="fi" {...register("externalRef")} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label htmlFor="si-cost-centre">Cost Centre / Department</label><input id="si-cost-centre" className="fi" {...register("costCentre")} /></div>
              <div className="fg"><label htmlFor="si-budget-owner">Budget Owner Email</label><input id="si-budget-owner" className="fi" {...register("budgetOwnerEmail")} /></div>
            </div>
            <div className="fg"><label htmlFor="si-secondary-contacts">Secondary Contacts</label><input id="si-secondary-contacts" className="fi" placeholder="Separate email addresses with commas" {...register("secondaryContacts")} /></div>
          </fieldset>
          <CustomFieldFormFields
            definitions={customFieldDefs}
            values={currentFields.customFieldValues || {}}
            onChange={(values) => setValue("customFieldValues", values, { shouldDirty: true })}
            idPrefix="si"
            loading={customFieldsLoading}
          />

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
              <div className="fr">
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-publisher`}>Publisher <span style={{ color: "var(--red)" }}>*</span></label>
                  <ReferenceCombobox
                    id={`sourcing-line-${line.id}-publisher`}
                    mode="publisher"
                    value={line.publisherName}
                    onChange={(value) => updateAdditionalLine(line.id, "publisherName", value)}
                    placeholder="Software publisher"
                  />
                </div>
              </div>
              <div className="fg">
                <label htmlFor={`sourcing-line-${line.id}-software`}>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  id={`sourcing-line-${line.id}-software`}
                  className="fi"
                  value={line.softwareDescription}
                  onChange={(e) => updateAdditionalLine(line.id, "softwareDescription", e.target.value)}
                  placeholder="Product or service name"
                />
              </div>
              <div className="fg">
                <label htmlFor={`sourcing-line-${line.id}-license-type`}>License Type <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span></label>
                <select
                  id={`sourcing-line-${line.id}-license-type`}
                  className="fi fi-select"
                  value={line.licenseType}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    updateAdditionalLine(line.id, "licenseType", nextType);
                    if (isFreewareLicenseType(nextType)) {
                      updateAdditionalLine(line.id, "estimatedUnitPrice", "");
                      updateAdditionalLine(line.id, "estimatedTotalPrice", "");
                    }
                  }}
                >
                  <option value="">Not specified</option>
                  {LICENSE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div className="fr">
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-quantity`}>Purchase Quantity</label>
                  <input
                    id={`sourcing-line-${line.id}-quantity`}
                    className="fi"
                    value={line.quantity}
                    onChange={(e) => updateAdditionalLine(line.id, "quantity", e.target.value)}
                    placeholder="e.g. 10"
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-currency`}>Currency</label>
                  <select
                    id={`sourcing-line-${line.id}-currency`}
                    className="fi"
                    value={line.currency}
                    onChange={(e) => updateAdditionalLine(line.id, "currency", e.target.value)}
                  >
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {!isFreewareLicenseType(line.licenseType) && (
              <div className="fr">
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-unit-price`}>Est. Unit Price</label>
                  <input
                    id={`sourcing-line-${line.id}-unit-price`}
                    className="fi"
                    value={line.estimatedUnitPrice}
                    onChange={(e) => updateAdditionalLine(line.id, "estimatedUnitPrice", e.target.value)}
                    placeholder="Unit price"
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-total-price`}>Est. Total Price</label>
                  <input
                    id={`sourcing-line-${line.id}-total-price`}
                    className="fi"
                    value={line.estimatedTotalPrice}
                    onChange={(e) => updateAdditionalLine(line.id, "estimatedTotalPrice", e.target.value)}
                    placeholder="Total price"
                  />
                </div>
              </div>
              )}
              <div className="fr">
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-start-date`}>Start Date</label>
                  <input
                    id={`sourcing-line-${line.id}-start-date`}
                    className="fi"
                    type="date"
                    value={line.startDate}
                    onChange={(e) => updateAdditionalLine(line.id, "startDate", e.target.value)}
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor={`sourcing-line-${line.id}-end-date`}>End Date</label>
                  <input
                    id={`sourcing-line-${line.id}-end-date`}
                    className="fi"
                    type="date"
                    value={line.endDate}
                    onChange={(e) => updateAdditionalLine(line.id, "endDate", e.target.value)}
                  />
                </div>
              </div>
              {line.isMaintenanceCompanion && (
                <>
                  <div className="fg">
                    <label htmlFor={`sourcing-line-${line.id}-supplier`}>Supplier</label>
                    <ReferenceCombobox
                      id={`sourcing-line-${line.id}-supplier`}
                      mode="supplier"
                      value={line.supplier}
                      onChange={(value) => updateAdditionalLine(line.id, "supplier", value)}
                      placeholder="Same supplier or a support provider"
                    />
                  </div>
                  <div className="fg">
                    <label htmlFor={`sourcing-line-${line.id}-contact`}>Supplier Contact</label>
                    <input
                      id={`sourcing-line-${line.id}-contact`}
                      className="fi"
                      value={line.contactEmail}
                      onChange={(e) => updateAdditionalLine(line.id, "contactEmail", e.target.value)}
                      placeholder="support@example.com"
                    />
                  </div>
                </>
              )}
              <fieldset className="fs">
                <legend>License record details</legend>
                <div className="fr">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-metric`}>License Metric</label><select id={`sourcing-line-${line.id}-metric`} className="fi fi-select" value={line.licenseMetric} onChange={(event) => updateAdditionalLine(line.id, "licenseMetric", event.target.value)}>{LICENSE_METRICS.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-quantity-per-unit`}>Quantity per Unit</label><input id={`sourcing-line-${line.id}-quantity-per-unit`} className="fi" inputMode="decimal" value={line.quantityPerUnit} onChange={(event) => updateAdditionalLine(line.id, "quantityPerUnit", event.target.value)} /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-sku`}>SKU Code</label><input id={`sourcing-line-${line.id}-sku`} className="fi" value={line.skuCode} onChange={(event) => updateAdditionalLine(line.id, "skuCode", event.target.value)} /></div>
                </div>
                {line.licenseType === "saas" && <div className="fg"><label htmlFor={`sourcing-line-${line.id}-portal`}>Portal URL</label><input id={`sourcing-line-${line.id}-portal`} className="fi" value={line.portalUrl} onChange={(event) => updateAdditionalLine(line.id, "portalUrl", event.target.value)} /></div>}
                <div className="fr">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-notice`}>Notice Date</label><input id={`sourcing-line-${line.id}-notice`} type="date" className="fi" value={line.noticeDate} onChange={(event) => updateAdditionalLine(line.id, "noticeDate", event.target.value)} /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-purchase`}>Purchase Date</label><input id={`sourcing-line-${line.id}-purchase`} type="date" className="fi" value={line.purchaseDate} onChange={(event) => updateAdditionalLine(line.id, "purchaseDate", event.target.value)} /></div>
                </div>
                <div className="fr">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-contract`}>Contract Number</label><input id={`sourcing-line-${line.id}-contract`} className="fi" value={line.contractNumber} onChange={(event) => updateAdditionalLine(line.id, "contractNumber", event.target.value)} /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-invoice`}>Invoice Number</label><input id={`sourcing-line-${line.id}-invoice`} className="fi" value={line.invoiceNumber} onChange={(event) => updateAdditionalLine(line.id, "invoiceNumber", event.target.value)} /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-external`}>External Reference</label><input id={`sourcing-line-${line.id}-external`} className="fi" value={line.externalRef} onChange={(event) => updateAdditionalLine(line.id, "externalRef", event.target.value)} /></div>
                </div>
                <div className="fr">
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-cost-centre`}>Cost Centre / Department</label><input id={`sourcing-line-${line.id}-cost-centre`} className="fi" value={line.costCentre} onChange={(event) => updateAdditionalLine(line.id, "costCentre", event.target.value)} /></div>
                  <div className="fg"><label htmlFor={`sourcing-line-${line.id}-budget-owner`}>Budget Owner Email</label><input id={`sourcing-line-${line.id}-budget-owner`} className="fi" value={line.budgetOwnerEmail} onChange={(event) => updateAdditionalLine(line.id, "budgetOwnerEmail", event.target.value)} /></div>
                </div>
                <div className="fg"><label htmlFor={`sourcing-line-${line.id}-secondary`}>Secondary Contacts</label><input id={`sourcing-line-${line.id}-secondary`} className="fi" value={line.secondaryContacts} onChange={(event) => updateAdditionalLine(line.id, "secondaryContacts", event.target.value)} /></div>
              </fieldset>
              <CustomFieldFormFields
                definitions={customFieldDefs}
                values={line.customFieldValues || {}}
                onChange={(values) => updateAdditionalLine(line.id, "customFieldValues", values)}
                idPrefix={`sourcing-line-${line.id}`}
                loading={customFieldsLoading}
              />
            </div>
          ))}

          {isNewRequest && (
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
        </div>
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

export default SourcingItemModal;

import React, { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CURRENCIES, LICENSE_TYPES } from "../../constants/licenseData.js";
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
import PluginSlot from "../plugins/PluginSlot.jsx";
import MaintenanceCoverageFields, {
  isFreewareLicenseType,
  supportsMaintenanceCoverage,
} from "./MaintenanceCoverageFields.jsx";

const schema = z.object({
  publisherName:       z.string().min(1, "Publisher is required."),
  softwareDescription: z.string().min(1, "Software description is required."),
  licenseType:         z.string(),
  maintenanceCoverage: z.string(),
  maintenanceStartDate: z.string(),
  maintenanceEndDate:  z.string(),
  maintenancePricingBasis: z.string(),
  maintenanceQuantity: z.string(),
  maintenanceUnitPrice: z.string(),
  maintenanceCost:     z.string(),
  quantity:            z.string(),
  estimatedUnitPrice:  z.string(),
  estimatedTotalPrice: z.string(),
  currency:            z.string(),
  startDate:           z.string(),
  endDate:             z.string(),
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
  quantity: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  startDate: "",
  endDate: "",
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
  userSettings,
  title,
  onSave,
  onCancel,
}) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const pendingOrderId = item?.pendingOrderId ?? item?.pending_order_id ?? null;
  const sourcingRequestId = item?.sourcingRequestId ?? item?.sourcing_request_id ?? null;
  const pluginSlot = pendingOrderId ? "pendingOrder.line.edit.actions" : "sourcing.item.edit.actions";
  const pluginTargetType = pendingOrderId ? "pending_order_item" : "sourcing_item";

  // "new request" mode: add mode with no parent request - supports multi-line and quote parse
  const isNewRequest = !item?.id && !requestId;
  const canAddMaintenanceCompanion = isNewRequest || !!pendingOrderId;

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
      maintenanceCoverage: item?.maintenanceCoverage ?? "unknown",
      maintenanceStartDate: item?.maintenanceStartDate ?? "",
      maintenanceEndDate:  item?.maintenanceEndDate ?? "",
      maintenancePricingBasis: item?.maintenancePricingBasis ?? "flat",
      maintenanceQuantity: item?.maintenanceQuantity ?? "",
      maintenanceUnitPrice: item?.maintenanceUnitPrice ?? "",
      maintenanceCost:     item?.maintenanceCost ?? "",
      quantity:            item?.quantity ?? "",
      estimatedUnitPrice:  item?.estimatedUnitPrice ?? "",
      estimatedTotalPrice: computeInitialTotal(item),
      currency:            item?.currency ?? "EUR",
      startDate:           item?.startDate ?? "",
      endDate:             item?.endDate ?? "",
      supplier:            item?.supplier ?? "",
      contactEmail:        item?.contactEmail ?? "",
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

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

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
          estimatedUnitPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : (parseLocalizedNumber(data.estimatedUnitPrice, userSettings) ?? data.estimatedUnitPrice) || null,
          estimatedTotalPrice: isFreewareLicenseType(data.licenseType)
            ? null
            : (parseLocalizedNumber(data.estimatedTotalPrice, userSettings) ?? data.estimatedTotalPrice) || null,
          currency: data.currency || "EUR",
          startDate: data.startDate || null,
          endDate: data.endDate || null,
        };
        const saved = await onSave({
          items: [
            primaryItem,
            ...additionalLines.map((l) => ({
              publisherName: l.publisherName,
              softwareDescription: l.softwareDescription,
              licenseType: l.licenseType || null,
              quantity: normalizeOptionalNumber(l.quantity, userSettings),
              estimatedUnitPrice: normalizeOptionalNumber(l.estimatedUnitPrice, userSettings),
              estimatedTotalPrice: normalizeOptionalNumber(l.estimatedTotalPrice, userSettings),
              currency: l.currency || "EUR",
              startDate: l.startDate || null,
              endDate: l.endDate || null,
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
              parentSourcingItemId: item.id,
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

  return (
    <>
      <ModalShell
        title={title ?? (item ? "Edit Sourcing Item" : "Add Sourcing Item")}
        titleId="dialog-title-sourcing-item"
        onClose={requestClose}
        modalStyle={{ maxWidth: "min(560px, 92vw)" }}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!canSave || saving} onClick={handleSubmit(onSubmit)}>
              {saving ? "Saving..." : lineCount > 1 ? `Save ${lineCount} lines` : "Save"}
            </button>
          </>
        )}
      >
        <div className="modal-bd">
          {/* Quote upload - always available (document attaches to the request).
              Parse Quote action is layered on below when a plugin is active. */}
          {isNewRequest && (
            <>
              <div className="fg" style={{ borderBottom: "1px solid var(--border-lt)", paddingBottom: 12, marginBottom: 4 }}>
                <label>Upload Quote <span style={{ fontWeight: 400, color: "var(--text-3)" }}>{slotHasActions ? "(optional — use Parse Quote to auto-fill)" : "(optional)"}</span></label>
                {attachedFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Icon name="file" size={14} color="var(--text-2)" />
                    <span style={{ fontSize: 12, color: "var(--text-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedFile.name}</span>
                    <button type="button" className="btn btn-g" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => handleFileChange(null)}>Remove</button>
                  </div>
                ) : (
                  <input type="file" className="fi" style={{ marginTop: 4 }} accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
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
              <input id="si-publisher" className="fi" placeholder="Software publisher" {...register("publisherName")} />
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
            currency={watch("currency")}
            locale={locale}
            onChange={(field, value) => setValue(field, value, { shouldDirty: true })}
            onAddSeparate={canAddMaintenanceCompanion ? addMaintenanceLine : undefined}
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
              <label htmlFor="si-supplier">Supplier</label>
              <input id="si-supplier" className="fi" placeholder="Reseller or direct supplier" {...register("supplier")} />
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

          {/* Additional lines (new-request mode only) */}
          {canAddMaintenanceCompanion && additionalLines.map((line, idx) => (
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
                  <label>Publisher <span style={{ color: "var(--red)" }}>*</span></label>
                  <input
                    className="fi"
                    value={line.publisherName}
                    onChange={(e) => updateAdditionalLine(line.id, "publisherName", e.target.value)}
                    placeholder="Software publisher"
                  />
                </div>
              </div>
              <div className="fg">
                <label>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  className="fi"
                  value={line.softwareDescription}
                  onChange={(e) => updateAdditionalLine(line.id, "softwareDescription", e.target.value)}
                  placeholder="Product or service name"
                />
              </div>
              <div className="fg">
                <label>License Type <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span></label>
                <select
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
                  <label>Purchase Quantity</label>
                  <input
                    className="fi"
                    value={line.quantity}
                    onChange={(e) => updateAdditionalLine(line.id, "quantity", e.target.value)}
                    placeholder="e.g. 10"
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label>Currency</label>
                  <select
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
                  <label>Est. Unit Price</label>
                  <input
                    className="fi"
                    value={line.estimatedUnitPrice}
                    onChange={(e) => updateAdditionalLine(line.id, "estimatedUnitPrice", e.target.value)}
                    placeholder="Unit price"
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label>Est. Total Price</label>
                  <input
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
                  <label>Start Date</label>
                  <input
                    className="fi"
                    type="date"
                    value={line.startDate}
                    onChange={(e) => updateAdditionalLine(line.id, "startDate", e.target.value)}
                  />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label>End Date</label>
                  <input
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
                    <label>Supplier</label>
                    <input
                      className="fi"
                      value={line.supplier}
                      onChange={(e) => updateAdditionalLine(line.id, "supplier", e.target.value)}
                      placeholder="Same supplier or a support provider"
                    />
                  </div>
                  <div className="fg">
                    <label>Supplier Contact</label>
                    <input
                      className="fi"
                      value={line.contactEmail}
                      onChange={(e) => updateAdditionalLine(line.id, "contactEmail", e.target.value)}
                      placeholder="support@example.com"
                    />
                  </div>
                </>
              )}
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

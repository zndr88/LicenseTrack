import React, { useState, useEffect, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { licenseFormSchema } from "../../utils/procurementSchemas.js";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES } from "../../constants/licenseData.js";
import Checkbox from "../ui/Checkbox.jsx";
import Icon from "../ui/Icon.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import { buildPendingOrderConversionPayload } from "./buildPendingOrderConversionPayload.js";
import PendingOrderInvoiceField from "./PendingOrderInvoiceField.jsx";
import ParentLicensePicker from "./ParentLicensePicker.jsx";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import PluginSlot from "../plugins/PluginSlot.jsx";

const APPLYABLE_PLUGIN_FIELDS = new Set([
  "publisherName",
  "softwareDescription",
  "startDate",
  "endDate",
  "contractNumber",
  "poNumber",
  "invoiceNumber",
  "contactEmail",
  "supplier",
  "costCentre",
  "licenseType",
  "licenseMetric",
  "portalUrl",
  "parentLicenseId",
  "parentSourcingItemId",
  "quantity",
  "skuCode",
  "unitPrice",
  "totalPoPrice",
  "currency",
  "budgetOwnerEmail",
  "notes",
]);

function pluginSuggestionFields(result) {
  const suggestions = result?.rawOutput?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((suggestion) => (
    Array.isArray(suggestion?.fields) ? suggestion.fields : []
  ));
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

// onConfirm(licenseData)
const ConvertPendingOrderModal = ({
  order,
  prefill,
  licenses = [],
  userSettings,
  onConfirm,
  onCancel,
}) => {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const isRenewal = order?.items?.some((item) => item.isRenewal);
  const vis = userSettings.visibleInDetail;

  const [saving, setSaving] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);
  const [displayUnitPrice, setDisplayUnitPrice] = useState(
    formatPriceInput(prefill.unitPrice || "", locale)
  );
  const [displayTotalPrice, setDisplayTotalPrice] = useState(
    formatPriceInput(prefill.totalPoPrice || "", locale)
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    watch,
    setValue,
    reset,
  } = useForm({
    resolver: zodResolver(licenseFormSchema),
    defaultValues: {
      publisherName:       prefill.publisherName       || "",
      softwareDescription: prefill.softwareDescription || "",
      startDate:           prefill.startDate           || "",
      endDate:             prefill.endDate             || "",
      isPerpetual:         false,
      contractNumber:      prefill.contractNumber      || "",
      poNumber:            prefill.poNumber            || "",
      invoiceNumber:       prefill.invoiceNumber       || "",
      contactEmail:        prefill.contactEmail        || "",
      supplier:            prefill.supplier            || "",
      costCentre:          prefill.costCentre          || "",
      licenseType:         prefill.licenseType         || "subscription",
      licenseMetric:       prefill.licenseMetric       || "per_user",
      portalUrl:           prefill.portalUrl           || "",
      parentLicenseId:     "",
      parentSourcingItemId: "",
      quantity:            prefill.quantity            || "",
      skuCode:             prefill.skuCode             || "",
      unitPrice:           prefill.unitPrice           || "",
      totalPoPrice:        prefill.totalPoPrice        || "",
      currency:            prefill.currency            || "EUR",
      budgetOwnerEmail:    prefill.budgetOwnerEmail    || "",
      notes:               prefill.notes               || "",
    },
  });

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty: isDirty || !!invoiceFile, onClose: onCancel });

  const quantity     = watch("quantity");
  const unitPrice    = watch("unitPrice");
  const isPerpetual  = watch("isPerpetual");
  const licenseType  = watch("licenseType");
  const parentLicenseId = watch("parentLicenseId");
  const publisherVal = watch("publisherName");
  const softwareVal  = watch("softwareDescription");
  const conversionDraftFields = watch();

  // Auto-compute totalPoPrice from quantity × unitPrice when not manually edited.
  useEffect(() => {
    const qtyStr  = String(quantity  ?? "").trim();
    const unitStr = String(unitPrice ?? "").trim();
    if (!qtyStr && !unitStr) {
      setTotalManuallyEdited(false);
      setValue("totalPoPrice", "", { shouldDirty: true });
      setDisplayTotalPrice("");
      return;
    }
    if (totalManuallyEdited) return;
    const qty  = Number(parseLocalizedNumber(qtyStr, userSettings));
    const unit = Number(parseLocalizedNumber(unitStr, userSettings));
    if (!isNaN(qty) && !isNaN(unit)) {
      const computed = (qty * unit).toFixed(2);
      setValue("totalPoPrice", computed, { shouldDirty: true });
      setDisplayTotalPrice(formatPriceInput(computed, locale));
    }
  }, [quantity, unitPrice, totalManuallyEdited]); // eslint-disable-line react-hooks/exhaustive-deps -- locale and setValue are session-stable

  const canSave =
    (publisherVal ?? "").trim() !== "" &&
    (softwareVal  ?? "").trim() !== "" &&
    (licenseType !== "maintenance" || parentLicenseId) &&
    String(quantity  ?? "").trim() !== "" &&
    String(unitPrice ?? "").trim() !== "";

  const applyPluginResult = useCallback((result) => {
    const fields = pluginSuggestionFields(result);
    if (!fields.length) return;

    const currentValues = watch();
    for (const field of fields) {
      const fieldName = field?.field;
      const value = field?.value;
      if (!APPLYABLE_PLUGIN_FIELDS.has(fieldName) || isBlank(value) || !isBlank(currentValues[fieldName])) {
        continue;
      }
      setValue(fieldName, String(value), { shouldDirty: true, shouldValidate: true });
      if (fieldName === "unitPrice") {
        setDisplayUnitPrice(formatPriceInput(value, locale));
      }
      if (fieldName === "totalPoPrice") {
        setTotalManuallyEdited(true);
        setDisplayTotalPrice(formatPriceInput(value, locale));
      }
    }
  }, [locale, setValue, watch]);

  const onSubmit = useCallback(async (data) => {
    setSaving(true);
    const licenseData = buildPendingOrderConversionPayload(data, userSettings);
    await onConfirm(licenseData, invoiceFile);
    reset();
    setInvoiceFile(null);
    setSaving(false);
  }, [onConfirm, reset, invoiceFile, userSettings]);

  return (
    <>
      <ModalShell
        title={`${isRenewal ? "Renew License" : "Convert to License"} - ${order.poNumber}`}
        titleId="dialog-title-convert-po"
        onClose={requestClose}
        onEscape={requestClose}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!canSave || saving} onClick={handleSubmit(onSubmit)}>
              {saving
                ? (isRenewal ? "Renewing..." : "Creating...")
                : <><Icon name="check" size={14} />{isRenewal ? "Confirm & Renew License" : "Confirm & Create License"}</>}
            </button>
          </>
        )}
      >
        <div className="modal-bd">

          {/* ── Renewal notice ── */}
          {isRenewal && (
            <div style={{ fontSize: 12, color: "var(--purple-text)", marginBottom: 12, padding: "8px 12px", background: "var(--purple-dim)", borderRadius: "var(--r)", border: "1px solid var(--purple-border)" }}>
              This will create a new license record with the updated dates and contract details. The existing license will be marked as Renewed and preserved for historical reference.
            </div>
          )}

          {order?.id && (
            <div className="plugin-slot-form-row">
              <PluginSlot
                slot="pendingOrder.convert.actions"
                context={{
                  targetType: "pending_order_conversion",
                  targetId: order.id,
                  pendingOrderId: order.id,
                  selectedLineItemIds: (order.items || []).map((item) => item.id),
                  conversionDraftFields,
                  documentIds: (order.documents || []).map((document) => document.id),
                }}
                onResult={applyPluginResult}
              />
            </div>
          )}

          <div className="fg">
            <label htmlFor="cpo-publisher-name">Publisher Name <span style={{ color: "var(--red)" }}>*</span></label>
            <input id="cpo-publisher-name" className="fi" placeholder="e.g. Microsoft" {...register("publisherName")} />
            {errors.publisherName && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.publisherName.message}</span>}
          </div>
          <div className="fg">
            <label htmlFor="cpo-software-desc">Software Description <span style={{ color: "var(--red)" }}>*</span></label>
            <input id="cpo-software-desc" className="fi" placeholder="e.g. Microsoft 365 E3" {...register("softwareDescription")} />
            {errors.softwareDescription && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.softwareDescription.message}</span>}
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor="cpo-start-date">Start Date</label>
              <input id="cpo-start-date" type="date" className="fi" {...register("startDate")} />
            </div>
            <div className="fg">
              <label htmlFor="cpo-end-date">End Date</label>
              {isPerpetual
                ? <input className="fi" value="Perpetual" disabled />
                : <input id="cpo-end-date" type="date" className="fi" {...register("endDate")} />
              }
              <div style={{ marginTop: 5 }}>
                <Controller
                  name="isPerpetual"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        if (v) {
                          setValue("endDate", "", { shouldDirty: true });
                          setValue("licenseType", "perpetual", { shouldDirty: true });
                          setValue("portalUrl", "", { shouldDirty: true });
                          setValue("parentLicenseId", "", { shouldDirty: true });
                        } else if (licenseType === "perpetual") {
                          setValue("licenseType", "subscription", { shouldDirty: true });
                        }
                      }}
                      label="Perpetual license"
                    />
                  )}
                />
              </div>
            </div>
          </div>
          <div className="fr">
            <div className="fg"><label htmlFor="cpo-contract-number">Contract Number</label><input id="cpo-contract-number" className="fi" {...register("contractNumber")} /></div>
            <div className="fg"><label htmlFor="cpo-po-number">PO Number</label><input id="cpo-po-number" className="fi" {...register("poNumber")} /></div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor="cpo-invoice-number">Invoice Number</label>
              <input id="cpo-invoice-number" className="fi" {...register("invoiceNumber")} />
            </div>
            <div className="fg">
              <label htmlFor="cpo-contact-email">Contact Email</label>
              <input id="cpo-contact-email" className="fi" {...register("contactEmail")} />
              {errors.contactEmail && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.contactEmail.message}</span>}
            </div>
          </div>
          <PendingOrderInvoiceField invoiceFile={invoiceFile} onChange={setInvoiceFile} />
          {(vis.supplier || vis.costCentre) && (
            <div className="fr">
              {vis.supplier    && <div className="fg"><label htmlFor="cpo-supplier">Supplier</label><input id="cpo-supplier" className="fi" placeholder="Direct or third-party" {...register("supplier")} /></div>}
              {vis.costCentre  && <div className="fg"><label htmlFor="cpo-cost-centre">Cost Centre / Department</label><input id="cpo-cost-centre" className="fi" placeholder="e.g. IT Operations" {...register("costCentre")} /></div>}
            </div>
          )}
          {(vis.licenseType || vis.licenseMetric) && (
            <div className="fr">
              {vis.licenseType && (
                <div className="fg">
                  <label htmlFor="cpo-license-type">License Type</label>
                  <select
                    id="cpo-license-type"
                    className="fi fi-select"
                    {...register("licenseType", {
                      onChange: (e) => {
                        const nextType = e.target.value;
                        if (nextType !== "saas") setValue("portalUrl", "", { shouldDirty: true });
                        if (nextType !== "maintenance") setValue("parentLicenseId", "", { shouldDirty: true });
                        if (nextType === "perpetual") {
                          setValue("isPerpetual", true, { shouldDirty: true });
                          setValue("endDate", "", { shouldDirty: true });
                        } else if (isPerpetual) {
                          setValue("isPerpetual", false, { shouldDirty: true });
                        }
                      },
                    })}
                  >
                    {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              )}
              {vis.licenseMetric && (
                <div className="fg">
                  <label htmlFor="cpo-license-metric">License Metric</label>
                  <select id="cpo-license-metric" className="fi fi-select" {...register("licenseMetric")}>
                    {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          {licenseType === "saas" && (
            <div className="fg">
              <label htmlFor="cpo-portal-url">Portal URL</label>
              <input id="cpo-portal-url" className="fi" placeholder="https://..." {...register("portalUrl")} />
            </div>
          )}
          {licenseType === "maintenance" && (
            <ParentLicensePicker
              id="cpo-parent-license"
              licenses={licenses}
              parentLicenseId={parentLicenseId}
              onSelectExisting={(value) => setValue("parentLicenseId", value, { shouldDirty: true })}
              onSelectPoItem={() => {}}
              error={errors.parentLicenseId?.message}
            />
          )}
          {(vis.quantity || vis.skuCode) && (
            <div className="fr">
              {vis.quantity && <div className="fg"><label htmlFor="cpo-quantity">Quantity <span style={{ color: "var(--red)" }}>*</span></label><input id="cpo-quantity" className="fi" {...register("quantity")} /></div>}
              {vis.skuCode  && <div className="fg"><label htmlFor="cpo-sku-code">SKU Code</label><input id="cpo-sku-code" className="fi" placeholder="e.g. AAA-13528" {...register("skuCode")} /></div>}
            </div>
          )}
          {(vis.unitPrice || vis.totalPoPrice) && (
            <div className="fr">
              {vis.unitPrice && (
                <div className="fg">
                  <label htmlFor="cpo-unit-price">Unit Price <span style={{ color: "var(--red)" }}>*</span> <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 400 }}>(excl. tax)</span></label>
                  <Controller
                    name="unitPrice"
                    control={control}
                    render={({ field }) => (
                      <input
                        id="cpo-unit-price"
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
                      />
                    )}
                  />
                </div>
              )}
              {vis.totalPoPrice && (
                <div className="fg">
                  <label htmlFor="cpo-total-price">Total PO Price</label>
                  <Controller
                    name="totalPoPrice"
                    control={control}
                    render={({ field }) => (
                      <input
                        id="cpo-total-price"
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
                      />
                    )}
                  />
                </div>
              )}
            </div>
          )}
          {(vis.unitPrice || vis.totalPoPrice) && (
            <div className="fg">
              <label htmlFor="cpo-currency">Currency</label>
              <select id="cpo-currency" className="fi fi-select" {...register("currency")}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div className="fg">
            <label htmlFor="cpo-budget-owner">Budget Owner Email</label>
            <input id="cpo-budget-owner" className="fi" placeholder="budget.owner@company.com" {...register("budgetOwnerEmail")} />
            {errors.budgetOwnerEmail && <span style={{ fontSize: 11, color: "var(--red)", marginTop: 2, display: "block" }}>{errors.budgetOwnerEmail.message}</span>}
          </div>
          {vis.notes && (
            <div className="fg">
              <label htmlFor="cpo-notes">Notes / Comments</label>
              <textarea id="cpo-notes" className="fi" rows={3} style={{ resize: "vertical" }} {...register("notes")} />
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

export default ConvertPendingOrderModal;

// frontend/src/components/procurement/ConvertAllModal.jsx
import React, { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { licenseFormSchema } from "../../utils/procurementSchemas.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import Icon from "../ui/Icon.jsx";
import { buildConvertItemDefaults } from "../../utils/buildConvertItemDefaults.js";
import { buildPendingOrderConversionPayload } from "./buildPendingOrderConversionPayload.js";
import ConvertItemForm, { isItemReady } from "./ConvertItemForm.jsx";
import PendingOrderInvoiceField from "./PendingOrderInvoiceField.jsx";
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";
import PluginSlot from "../plugins/PluginSlot.jsx";
import { pendingOrderLabel } from "../../utils/procurementLabels.js";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { buildCustomFieldValuePayload } from "../../utils/customFieldFormValues.js";

const formSchema = z.object({ items: z.array(licenseFormSchema) });

const SHARED_FIELD_KEYS = [
  "poNumber",
  "procurementReference",
  "contractNumber",
  "invoiceNumber",
  "purchaseDate",
  "contactEmail",
  "supplier",
  "costCentre",
  "currency",
  "budgetOwnerEmail",
];

export default function ConvertAllModal({ order, licenses, userSettings, onConfirm, onCancel }) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const unconvertedItems = order.items ?? [];
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { isDirty, errors },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      items: buildConvertItemDefaults(order, licenses, userSettings?.displayCurrency),
    },
  });

  const { fields } = useFieldArray({ control, name: "items" });

  const [saving, setSaving] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: isDirty || !!invoiceFile,
    onClose: onCancel,
  });

  const watchedItems = watch("items") ?? [];
  const readyCount = watchedItems.filter(isItemReady).length;
  const allReady = readyCount === fields.length && fields.length > 0;

  const copySharedFieldsFromFirstItem = () => {
    const source = watchedItems[0];
    if (!source || fields.length < 2) return;

    for (let idx = 1; idx < fields.length; idx += 1) {
      for (const key of SHARED_FIELD_KEYS) {
        setValue(`items.${idx}.${key}`, source[key] ?? "", {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    }
  };

  const onSubmit = async (data) => {
    setSaving(true);
    const payload = data.items.map((item, idx) => {
      const si = unconvertedItems[idx];
      return {
        ...buildPendingOrderConversionPayload({
          ...item,
          customFieldValuesPayload: buildCustomFieldValuePayload(
            customFieldDefs,
            item.customFieldValues,
            userSettings,
          ),
        }, userSettings),
        sourcingItemId: si.id,
        ...(item.licenseType === "maintenance" && item.parentSourcingItemId ? { parentSourcingItemId: parseInt(item.parentSourcingItemId, 10) } : {}),
      };
    });
    const ok = await onConfirm(order.id, payload, invoiceFile);
    if (!ok) setSaving(false);
    else {
      reset();
      setInvoiceFile(null);
    }
  };

  return (
    <>
      <ModalShell
        title={`Convert ${pendingOrderLabel(order)} - ${unconvertedItems.length} ${unconvertedItems.length === 1 ? "item" : "items"}`}
        titleId="dialog-title-convert-all"
        onClose={requestClose}
        onEscape={requestClose}
        modalClassName="modal document-assisted-modal"
        modalStyle={{
          width: invoiceFile ? "min(1120px, 94vw)" : undefined,
          maxWidth: invoiceFile ? "min(1120px, 94vw)" : "min(720px, 92vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: invoiceFile ? "hidden" : undefined,
        }}
        footer={(
          <>
            <span style={{ flex: 1, fontSize: 12, color: "var(--text-2)" }}>
              {readyCount} of {fields.length} {fields.length === 1 ? "item" : "items"} ready
            </span>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!allReady || saving} onClick={handleSubmit(onSubmit)}>
              {saving
                ? <><div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />&nbsp;Creating...</>
                : <><Icon name="check" size={14} />Confirm &amp; Create Licenses</>
              }
            </button>
          </>
        )}
      >
        <div className={`document-assisted-modal-layout${invoiceFile ? " has-document-preview" : ""}`}>
          <LocalDocumentPreviewPanel
            ariaLabel="Attached invoice preview"
            file={invoiceFile}
            label="Invoice Preview"
          />
          <div className="modal-bd document-assisted-modal-form">
          {order?.id && (
            <div className="plugin-slot-form-row">
              <PluginSlot
                slot="pendingOrder.convert.actions"
                context={{
                  targetType: "pending_order_conversion",
                  targetId: order.id,
                  pendingOrderId: order.id,
                  selectedLineItemIds: unconvertedItems.map((item) => item.id),
                  conversionDraftFields: { items: watchedItems },
                  documentIds: (order.documents || []).map((document) => document.id),
                }}
              />
            </div>
          )}
          <PendingOrderInvoiceField invoiceFile={invoiceFile} onChange={setInvoiceFile} />
          {fields.length > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 12,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--r)",
                background: "var(--bg-2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Icon name="info" size={14} color="var(--text-3)" />
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                  Copy shared PO details from the first item to the remaining items.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-g"
                style={{ padding: "5px 10px", fontSize: 11, flexShrink: 0 }}
                title="Copies shared fields from item 1 and may overwrite values already entered on other items. Always review every license before confirming."
                aria-label="Copy shared fields from first item"
                onClick={copySharedFieldsFromFirstItem}
              >
                <Icon name="refresh" size={12} />
                Copy shared fields
              </button>
            </div>
          )}
          {fields.map((field, idx) => (
            <ConvertItemForm
              key={field.id}
              idx={idx}
              sourcingItem={unconvertedItems[idx]}
              poItems={unconvertedItems}
              watchedItems={watchedItems}
              licenses={licenses}
              watchedItem={watchedItems[idx]}
              errors={errors.items?.[idx]}
              control={control}
              register={register}
              setValue={setValue}
              locale={locale}
              customFieldDefs={customFieldDefs}
              customFieldsLoading={customFieldsLoading}
            />
          ))}
        </div>
        </div>
      </ModalShell>

      {showDiscardDialog && (
        <DiscardChangesDialog
          onDiscard={() => { reset(); setInvoiceFile(null); onCancel(); }}
          onKeep={() => setShowDiscardDialog(false)}
        />
      )}
    </>
  );
}

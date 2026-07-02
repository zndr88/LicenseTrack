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
import ConvertItemForm, { isItemReady } from "./ConvertItemForm.jsx";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import PluginSlot from "../plugins/PluginSlot.jsx";

const formSchema = z.object({ items: z.array(licenseFormSchema) });

const SHARED_FIELD_KEYS = [
  "poNumber",
  "contractNumber",
  "invoiceNumber",
  "contactEmail",
  "supplier",
  "costCentre",
  "currency",
  "budgetOwnerEmail",
];

export default function ConvertAllModal({ order, licenses, userSettings, onConfirm, onCancel }) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const unconvertedItems = order.items ?? [];

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
    defaultValues: { items: buildConvertItemDefaults(order, licenses) },
  });

  const { fields } = useFieldArray({ control, name: "items" });

  const [saving, setSaving] = useState(false);
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

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
      const entry = {
        sourcingItemId:      si.id,
        publisherName:       item.publisherName.trim(),
        softwareDescription: item.softwareDescription.trim(),
        startDate:           item.startDate || null,
        endDate:             item.isPerpetual ? null : item.endDate || null,
        contractNumber:      item.contractNumber,
        poNumber:            item.poNumber,
        invoiceNumber:       item.invoiceNumber,
        contactEmail:        item.contactEmail,
        supplier:            item.supplier,
        costCentre:          item.costCentre,
        licenseType:         item.licenseType || "subscription",
        licenseMetric:       item.licenseMetric || "per_user",
        portalUrl:           item.licenseType === "saas" ? (item.portalUrl || null) : null,
        ...(item.licenseType === "maintenance" && item.parentLicenseId ? { parentLicenseId: parseInt(item.parentLicenseId, 10) } : {}),
        ...(item.licenseType === "maintenance" && item.parentSourcingItemId ? { parentSourcingItemId: parseInt(item.parentSourcingItemId, 10) } : {}),
        quantity:            parseLocalizedNumber(item.quantity, userSettings) ?? item.quantity,
        skuCode:             item.skuCode,
        unitPrice:           item.unitPrice,
        totalPoPrice:        item.totalPoPrice,
        currency:            item.currency,
        budgetOwnerEmail:    item.budgetOwnerEmail,
        notes:               item.notes || null,
      };
      return entry;
    });
    const ok = await onConfirm(order.id, payload);
    if (!ok) setSaving(false);
    else reset();
  };

  return (
    <>
      <ModalShell
        title={`Convert PO ${order.poNumber} - ${unconvertedItems.length} ${unconvertedItems.length === 1 ? "item" : "items"}`}
        titleId="dialog-title-convert-all"
        onClose={requestClose}
        onEscape={requestClose}
        modalStyle={{ maxWidth: "min(720px, 92vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
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
        <div className="modal-bd" style={{ overflowY: "auto", flex: 1 }}>
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
            />
          ))}
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
}

import React, { useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CURRENCIES, LICENSE_TYPES } from "../../constants/licenseData.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import { createSourcingRequestEditSchema } from "../../utils/procurementSchemas.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

function itemDefaults(item) {
  return {
    id: item.id,
    status: item.status ?? null,
    publisherName: item.publisherName ?? "",
    softwareDescription: item.softwareDescription ?? "",
    licenseType: item.licenseType ?? "",
    quantity: item.quantity ?? "",
    estimatedUnitPrice: item.estimatedUnitPrice ?? "",
    estimatedTotalPrice: item.estimatedTotalPrice ?? "",
    currency: item.currency ?? "EUR",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    notes: item.notes ?? "",
  };
}

function normalizeOptionalNumber(value, userSettings) {
  return (parseLocalizedNumber(value, userSettings) ?? value) || null;
}

export default function SourcingRequestEditModal({ request, userSettings, onSave, onCancel }) {
  const schema = useMemo(() => createSourcingRequestEditSchema(userSettings), [userSettings]);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      supplier: request.supplier ?? "",
      contactEmail: request.contactEmail ?? "",
      notes: request.notes ?? "",
      items: (request.items ?? []).map(itemDefaults),
    },
  });
  const { fields } = useFieldArray({ control, name: "items", keyName: "formKey" });
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty,
    onClose: onCancel,
  });

  const submit = async (values) => {
    const items = values.items
      .filter((item) => !["converted", "cancelled"].includes(item.status))
      .map((item) => ({
        id: item.id,
        publisherName: item.publisherName.trim(),
        softwareDescription: item.softwareDescription.trim(),
        licenseType: item.licenseType || null,
        quantity: normalizeOptionalNumber(item.quantity, userSettings),
        estimatedUnitPrice: normalizeOptionalNumber(item.estimatedUnitPrice, userSettings),
        estimatedTotalPrice: normalizeOptionalNumber(item.estimatedTotalPrice, userSettings),
        currency: item.currency,
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        notes: item.notes || null,
      }));
    const saved = await onSave({
      supplier: values.supplier.trim(),
      contactEmail: values.contactEmail.trim(),
      notes: values.notes,
      items,
    });
    if (saved) onCancel();
  };

  return (
    <>
    <ModalShell
      title="Edit Sourcing Request"
      titleId="dialog-title-sourcing-request-edit"
      onClose={requestClose}
      modalClassName="modal sourcing-request-edit-modal"
      footer={(
        <>
          <button className="btn btn-g" onClick={requestClose} disabled={isSubmitting}>Cancel</button>
          <button className="btn btn-p" onClick={handleSubmit(submit)} disabled={isSubmitting || !isDirty || !isValid}>
            {isSubmitting ? "Saving..." : "Save Sourcing Request"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <div className="fr">
          <div className="fg">
            <label htmlFor="sourcing-request-supplier">Supplier</label>
            <Controller
              name="supplier"
              control={control}
              render={({ field }) => (
                <ReferenceCombobox id="sourcing-request-supplier" mode="supplier" {...field} />
              )}
            />
          </div>
          <div className="fg">
            <label htmlFor="sourcing-request-contact">Supplier Contact</label>
            <input id="sourcing-request-contact" className="fi" type="email" {...register("contactEmail")} />
            {errors.contactEmail && <span className="field-error">{errors.contactEmail.message}</span>}
          </div>
        </div>
        <div className="fg">
          <label htmlFor="sourcing-request-notes">Request Notes</label>
          <textarea id="sourcing-request-notes" className="fi" rows={3} {...register("notes")} />
        </div>

        <div className="fs sourcing-request-edit-heading">
          <h4>Line Items</h4>
          <p>Changes to open lines are saved atomically with the request. Converted or cancelled lines remain read-only.</p>
        </div>
        {fields.map((item, index) => {
          const readOnly = item.status === "converted" || item.status === "cancelled";
          const itemErrors = errors.items?.[index] || {};
          return (
            <fieldset key={item.formKey} className="sourcing-request-edit-line" disabled={readOnly}>
              <input type="hidden" {...register(`items.${index}.id`, { valueAsNumber: true })} />
              <input type="hidden" {...register(`items.${index}.status`)} />
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-publisher`}>Publisher</label>
                  <Controller
                    name={`items.${index}.publisherName`}
                    control={control}
                    render={({ field }) => (
                      <ReferenceCombobox id={`sourcing-request-item-${item.id}-publisher`} mode="publisher" disabled={readOnly} {...field} />
                    )}
                  />
                  {itemErrors.publisherName && <span className="field-error">{itemErrors.publisherName.message}</span>}
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-description`}>Software Description</label>
                  <input id={`sourcing-request-item-${item.id}-description`} className="fi" {...register(`items.${index}.softwareDescription`)} />
                  {itemErrors.softwareDescription && <span className="field-error">{itemErrors.softwareDescription.message}</span>}
                </div>
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-type`}>License Type</label>
                  <select id={`sourcing-request-item-${item.id}-type`} className="fi fi-select" {...register(`items.${index}.licenseType`)}>
                    <option value="">Select...</option>
                    {LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-quantity`}>Quantity</label>
                  <input id={`sourcing-request-item-${item.id}-quantity`} className="fi" inputMode="decimal" {...register(`items.${index}.quantity`)} />
                  {itemErrors.quantity && <span className="field-error">{itemErrors.quantity.message}</span>}
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-currency`}>Currency</label>
                  <select id={`sourcing-request-item-${item.id}-currency`} className="fi fi-select" {...register(`items.${index}.currency`)}>
                    {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-unit`}>Estimated Unit Price</label><input id={`sourcing-request-item-${item.id}-unit`} className="fi" inputMode="decimal" {...register(`items.${index}.estimatedUnitPrice`)} />{itemErrors.estimatedUnitPrice && <span className="field-error">{itemErrors.estimatedUnitPrice.message}</span>}</div>
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-total`}>Estimated Total Price</label><input id={`sourcing-request-item-${item.id}-total`} className="fi" inputMode="decimal" {...register(`items.${index}.estimatedTotalPrice`)} />{itemErrors.estimatedTotalPrice && <span className="field-error">{itemErrors.estimatedTotalPrice.message}</span>}</div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-start`}>Start Date</label><input id={`sourcing-request-item-${item.id}-start`} type="date" className="fi" {...register(`items.${index}.startDate`)} /></div>
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-end`}>End Date</label><input id={`sourcing-request-item-${item.id}-end`} type="date" className="fi" {...register(`items.${index}.endDate`)} /></div>
              </div>
              <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-notes`}>Line Notes</label><textarea id={`sourcing-request-item-${item.id}-notes`} className="fi" rows={2} {...register(`items.${index}.notes`)} /></div>
            </fieldset>
          );
        })}
      </div>
    </ModalShell>
    {showDiscardDialog && (
      <DiscardChangesDialog
        onDiscard={onCancel}
        onKeep={() => setShowDiscardDialog(false)}
      />
    )}
    </>
  );
}

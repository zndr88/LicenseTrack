import { useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { buildCustomFieldValuePayload, customFieldValueMap } from "../../utils/customFieldFormValues.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import { createSourcingRequestEditSchema } from "../../utils/procurementSchemas.js";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import SourcingRequestLineEditor from "./SourcingRequestLineEditor.jsx";

function itemDefaults(item) {
  return {
    id: item.id,
    status: item.status ?? null,
    publisherName: item.publisherName ?? "",
    softwareDescription: item.softwareDescription ?? "",
    licenseType: item.licenseType ?? "",
    licenseMetric: item.licenseMetric ?? "per_user",
    portalUrl: item.portalUrl ?? "",
    quantity: item.quantity ?? "",
    quantityPerUnit: item.quantityPerUnit ?? "1",
    skuCode: item.skuCode ?? "",
    estimatedUnitPrice: item.estimatedUnitPrice ?? "",
    estimatedTotalPrice: item.estimatedTotalPrice ?? "",
    currency: item.currency ?? "EUR",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    noticeDate: item.noticeDate ?? "",
    purchaseDate: item.purchaseDate ?? "",
    contractNumber: item.contractNumber ?? "",
    invoiceNumber: item.invoiceNumber ?? "",
    externalRef: item.externalRef ?? "",
    costCentre: item.costCentre ?? "",
    budgetOwnerEmail: item.budgetOwnerEmail ?? "",
    secondaryContacts: (item.secondaryContacts ?? []).join(", "),
    customFieldValues: customFieldValueMap(item.customFieldValues),
    notes: item.notes ?? "",
  };
}

function normalizeOptionalNumber(value, userSettings) {
  return (parseLocalizedNumber(value, userSettings) ?? value) || null;
}

export default function SourcingRequestEditModal({ request, userSettings, onSave, onCancel }) {
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();
  const schema = useMemo(() => createSourcingRequestEditSchema(userSettings), [userSettings]);
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
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
        licenseMetric: item.licenseMetric || null,
        portalUrl: item.licenseType === "saas" ? item.portalUrl || null : null,
        quantity: normalizeOptionalNumber(item.quantity, userSettings),
        quantityPerUnit: normalizeOptionalNumber(item.quantityPerUnit, userSettings) || "1",
        skuCode: item.skuCode || null,
        estimatedUnitPrice: normalizeOptionalNumber(item.estimatedUnitPrice, userSettings),
        estimatedTotalPrice: normalizeOptionalNumber(item.estimatedTotalPrice, userSettings),
        currency: item.currency,
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        noticeDate: item.noticeDate || null,
        purchaseDate: item.purchaseDate || null,
        contractNumber: item.contractNumber || null,
        invoiceNumber: item.invoiceNumber || null,
        externalRef: item.externalRef || null,
        costCentre: item.costCentre || null,
        budgetOwnerEmail: item.budgetOwnerEmail || null,
        secondaryContacts: String(item.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
        customFieldValues: buildCustomFieldValuePayload(customFieldDefs, item.customFieldValues, userSettings),
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
        modalClassName="modal document-assisted-modal sourcing-request-edit-modal"
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={isSubmitting}>Cancel</button>
            <button className="btn btn-p" onClick={handleSubmit(submit)} disabled={isSubmitting || !isDirty || !isValid}>
              {isSubmitting ? "Saving..." : "Save Sourcing Request"}
            </button>
          </>
        )}
      >
        <div className="modal-bd document-assisted-modal-form">
          <div className="license-form-stack">
            <LicenseFormSection title="Request Details">
              <div className="fr">
                <div className="fg">
                  <label htmlFor="sourcing-request-supplier">Supplier</label>
                  <Controller
                    name="supplier"
                    control={control}
                    render={({ field }) => <ReferenceCombobox id="sourcing-request-supplier" mode="supplier" {...field} />}
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
            </LicenseFormSection>

            <div className="sourcing-request-edit-heading">
              <h4>Line Items</h4>
              <p>Changes to open lines are saved atomically with the request. Converted or cancelled lines remain read-only.</p>
            </div>
            {fields.map((item, index) => (
              <SourcingRequestLineEditor
                key={item.formKey}
                item={item}
                index={index}
                control={control}
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors.items?.[index] || {}}
                customFieldDefs={customFieldDefs}
                customFieldsLoading={customFieldsLoading}
              />
            ))}
          </div>
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

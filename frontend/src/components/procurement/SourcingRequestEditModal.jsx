import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { buildCustomFieldValuePayload, customFieldValueMap } from "../../utils/customFieldFormValues.js";
import { parseTypedNumber } from "../../utils/formatting.js";
import { createSourcingRequestEditSchema } from "../../utils/procurementSchemas.js";
import { filterCustomFieldDefinitionsForRenewal } from "../../utils/customFieldRenewal.js";
import { filterCustomFieldDefinitionsForSourcing } from "../../utils/customFieldSourcing.js";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import SourcingRequestLineEditor from "./SourcingRequestLineEditor.jsx";
import DocumentStagingWorkspace from "./DocumentStagingWorkspace.jsx";
import { useStagedDocumentAttachments } from "./useStagedDocumentAttachments.js";
import { previewSourcingQuoteDocument, downloadSourcingQuoteDocument } from "../../api/sourcing.js";
import { formatSecondaryContacts, parseSecondaryContacts } from "../../utils/secondaryContacts.js";
import SupplierContactPrompt from "./SupplierContactPrompt.jsx";
import { useSupplierContactPrompt } from "../../hooks/useSupplierContactPrompt.js";
import { typeOptInPayload } from "../../utils/licenseTypeRules.js";

function itemDefaults(item) {
  return {
    id: item.id,
    status: item.status ?? null,
    isRenewal: Boolean(item.isRenewal || item.renewalForLicenseId != null),
    publisherName: item.publisherName ?? "",
    softwareDescription: item.softwareDescription ?? "",
    licenseType: item.licenseType ?? "",
    licenseMetric: item.licenseMetric ?? "per_user",
    portalUrl: item.portalUrl ?? "",
    isRenewable: item.isRenewable ?? false,
    typeDescription: item.typeDescription ?? "",
    maintenanceCoverage: item.maintenanceCoverage ?? "",
    maintenanceStartDate: item.maintenanceStartDate ?? "",
    maintenanceEndDate: item.maintenanceEndDate ?? "",
    maintenancePricingBasis: item.maintenancePricingBasis ?? "flat",
    maintenanceQuantity: item.maintenanceQuantity ?? "",
    maintenanceUnitPrice: item.maintenanceUnitPrice ?? "",
    maintenanceCost: item.maintenanceCost ?? "",
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
    secondaryContacts: formatSecondaryContacts(item.secondaryContacts),
    customFieldValues: customFieldValueMap(item.customFieldValues),
    notes: item.notes ?? "",
  };
}

function normalizeOptionalNumber(value, userSettings) {
  return (parseTypedNumber(value, userSettings) ?? value) || null;
}

export default function SourcingRequestEditModal({ request, userSettings, onSave, onCancel, onDeleteDocument }) {
  const { definitions: customFieldDefs, loading: customFieldsLoading } = useCustomFieldDefinitions();
  const schema = useMemo(() => createSourcingRequestEditSchema(userSettings), [userSettings]);
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting },
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
  const contactPrompt = useSupplierContactPrompt({
    initialSupplier: request.supplier,
    supplier: watch("supplier"),
    initialContact: request.contactEmail,
    contact: watch("contactEmail"),
  });
  const { attachments, categoryScopes, addFiles, removeAttachment, changeTarget, changeCategoryScope, clearAttachments } = useStagedDocumentAttachments(request.items?.[0]?.id);
  const [documentPreviewVisible, setDocumentPreviewVisible] = useState(false);
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: isDirty || attachments.length > 0,
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
        ...typeOptInPayload(item),
        maintenanceCoverage: item.maintenanceCoverage || null,
        maintenanceStartDate: item.maintenanceStartDate || null,
        maintenanceEndDate: item.maintenanceEndDate || null,
        maintenancePricingBasis: item.maintenancePricingBasis || null,
        maintenanceQuantity: normalizeOptionalNumber(item.maintenanceQuantity, userSettings),
        maintenanceUnitPrice: normalizeOptionalNumber(item.maintenanceUnitPrice, userSettings),
        maintenanceCost: normalizeOptionalNumber(item.maintenanceCost, userSettings),
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
        secondaryContacts: parseSecondaryContacts(item.secondaryContacts),
        customFieldValues: buildCustomFieldValuePayload(
          filterCustomFieldDefinitionsForSourcing(
            filterCustomFieldDefinitionsForRenewal(customFieldDefs, item.isRenewal),
          ),
          item.customFieldValues,
          userSettings,
        ),
        notes: item.notes || null,
      }));
    const saved = await onSave({
      supplier: values.supplier.trim(),
      contactEmail: values.contactEmail.trim(),
      notes: values.notes,
      items,
      attachments,
      attachmentTargetKeys: (request.items ?? []).map((item) => String(item.id)),
    });
    if (saved) { clearAttachments(); onCancel(); }
  };

  return (
    <>
      <ModalShell
        title="Edit Sourcing Request"
        sectionControls
        titleId="dialog-title-sourcing-request-edit"
        onClose={requestClose}
        modalClassName={`modal document-assisted-modal sourcing-request-edit-modal${documentPreviewVisible ? " has-document-preview" : ""}`}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={isSubmitting}>Cancel</button>
            <button className="btn btn-p" onClick={handleSubmit(submit)} disabled={isSubmitting || (!isDirty && !attachments.length)}>
              {isSubmitting ? "Saving..." : "Save Sourcing Request"}
            </button>
          </>
        )}
      >
        <div className="license-intake-modal-layout"><div className="modal-bd document-assisted-modal-form">
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
              {contactPrompt.visible && (
                <SupplierContactPrompt
                  contactInputId="sourcing-request-contact"
                  onKeep={contactPrompt.answer}
                  onClear={() => {
                    setValue("contactEmail", "", { shouldDirty: true, shouldValidate: true });
                    contactPrompt.answer();
                  }}
                />
              )}
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
                userSettings={userSettings}
              />
            ))}
          </div>
        </div>
        <DocumentStagingWorkspace
          attachments={attachments}
          categoryScopes={categoryScopes}
          documents={(request.quoteDocuments ?? []).map((document) => ({ ...document, category: document.category ?? "quote" }))}
          inputIdPrefix="sourcing-request-edit-attachment"
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onTargetChange={changeTarget}
          onCategoryScopeChange={changeCategoryScope}
          previewDocument={previewSourcingQuoteDocument}
          downloadDocument={(document) => downloadSourcingQuoteDocument(document.id, document.originalFilename ?? document.original_filename)}
          onDeleteDocument={onDeleteDocument}
          onPreviewVisibilityChange={setDocumentPreviewVisible}
          targetOptions={(request.items ?? []).map((item, index) => ({ value: String(item.id), label: item.softwareDescription || `Line ${index + 1}` }))}
          userSettings={userSettings}
          defaultOpen
        />
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

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createLicenseBatch } from "../api/licenses.js";
import { uploadDocument } from "../api/documents.js";
import { queryKeys } from "../queryKeys.js";
import { invalidateNotifications, invalidatePortfolioState } from "../queryInvalidation.js";
import { defaultDocumentScope } from "../utils/documentCategories.js";

function buildLicensePayload(form) {
  return {
    publisherName: form.publisherName,
    softwareDescription: form.softwareDescription,
    startDate: form.startDate || null,
    endDate: form.isPerpetual ? null : (form.endDate || null),
    noticeDate: form.noticeDate || null,
    purchaseDate: form.purchaseDate || null,
    contractNumber: form.contractNumber || "",
    poNumber: form.poNumber || "",
    procurementReference: form.procurementReference || "",
    invoiceNumber: form.invoiceNumber || "",
    contactEmail: form.contactEmail || "",
    supplier: form.supplier || "",
    costCentre: form.costCentre || "",
    licenseType: form.licenseType || "subscription",
    licenseMetric: form.licenseMetric || "per_user",
    portalUrl: form.licenseType === "saas" ? (form.portalUrl || null) : null,
    quantity: form.quantity || "",
    quantityPerUnit: form.quantityPerUnit || "1",
    skuCode: form.skuCode || "",
    unitPrice: form.unitPrice || "",
    totalPoPrice: form.totalPoPrice || "",
    currency: form.currency || "EUR",
    notes: form.notes || null,
    budgetOwnerEmail: form.budgetOwnerEmail || "",
    secondaryContacts: form.secondaryContacts || [],
    externalRef: form.externalRef || null,
    customFieldValues: form.customFieldValues || [],
    maintenanceCoverage: form.maintenanceCoverage || null,
    maintenanceStartDate: form.maintenanceStartDate || null,
    maintenanceEndDate: form.maintenanceEndDate || null,
    maintenancePricingBasis: form.maintenancePricingBasis || null,
    maintenanceQuantity: form.maintenanceQuantity || null,
    maintenanceUnitPrice: form.maintenanceUnitPrice || null,
    maintenanceCost: form.maintenanceCost || "",
    ...(form.parentLicenseId ? { parentLicenseId: form.parentLicenseId } : {}),
    ...(form.maintenanceParentIds?.length ? { maintenanceParentIds: form.maintenanceParentIds } : {}),
    isRetired: false,
  };
}

export function useLicenseCreation({
  setConfirmData,
  setPage,
  setSelectedId,
  showError,
}) {
  const queryClient = useQueryClient();

  return useCallback(async (forms, attachmentInput, legacyCategory = "invoice") => {
    const formList = Array.isArray(forms) ? forms : [forms];
    const attachments = !attachmentInput
      ? []
      : (Array.isArray(attachmentInput)
        ? attachmentInput
        : [{ file: attachmentInput, category: legacyCategory }]);
    const items = formList.map((form) => {
      const hasBatchParent = Number.isInteger(form.parentLineIndex);
      return {
        license: buildLicensePayload({
          ...form,
          parentLicenseId: hasBatchParent ? null : form.parentLicenseId,
        }),
        ...(hasBatchParent ? { parentLineIndex: form.parentLineIndex } : {}),
      };
    });
    const { data: created = [], error } = await createLicenseBatch(items);
    if (error) {
      showError(error);
      return false;
    }

    let documentUploadError = null;
    let documentErrorTargetId = created[0]?.id ?? null;
    for (const attachment of attachments) {
      const attachmentScope = attachment.scope ?? defaultDocumentScope(attachment.category);
      const targetIndex = attachmentScope === "shared"
        ? 0
        : Math.max(0, formList.findIndex((form) => String(form._documentTargetKey) === String(attachment.targetKey)));
      const targetId = created[targetIndex]?.id ?? created[0]?.id ?? null;
      if (!targetId) continue;
      const { error: docError } = await uploadDocument(
        targetId,
        attachment.file,
        attachment.category,
        attachmentScope,
      );
      if (docError) {
        documentUploadError = `${attachment.file.name}: ${docError}`;
        documentErrorTargetId = targetId;
        break;
      }
    }
    if (documentUploadError) {
      setSelectedId(documentErrorTargetId);
      showError(
        `License${formList.length > 1 ? "s" : ""} saved, but document upload failed: ${documentUploadError}. `
        + "Retry the attachment from License Details; do not resubmit the licenses."
      );
    }
    setConfirmData(null);
    setPage("licenses");
    queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
    invalidatePortfolioState(queryClient);
    invalidateNotifications(queryClient);
    return true;
  }, [queryClient, setConfirmData, setPage, setSelectedId, showError]);
}

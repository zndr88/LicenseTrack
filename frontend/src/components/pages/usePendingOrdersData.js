import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addItemsToPendingOrderBulk,
  batchConvertPendingOrder,
  cancelPendingOrder as apiCancelPendingOrder,
  convertPendingOrder,
  createPendingOrder as apiCreatePendingOrder,
  deletePendingOrderDocument,
  deletePendingOrderItem as apiDeletePendingOrderItem,
  downloadPendingOrderDocument,
  exportPendingOrdersCsv,
  getPendingOrderHistory,
  getPendingOrders,
  retryPendingOrderEvidenceTransfer,
  uploadPendingOrderDocument,
  updatePendingOrderItem as apiUpdatePendingOrderItem,
  updatePendingOrder as apiUpdatePendingOrder,
} from "../../api/pendingOrders.js";
import {
  deleteSourcingQuoteDocument,
  downloadSourcingQuoteDocument,
} from "../../api/sourcing.js";
import { queryKeys } from "../../queryKeys.js";
import { invalidateProcurementRenewalState } from "../../queryInvalidation.js";
import { fetchLicensesData } from "./licenses/useLicensesPageData.js";
import { getLicensesFromQueryData } from "../../utils/licenseQueryData.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

const EMPTY_PENDING_ORDERS = [];

async function fetchPendingOrders() {
  const { data, error } = await getPendingOrders({ includeEvidenceIssues: true });
  if (error) throw new Error(error);
  return data ?? [];
}

async function fetchPendingOrderHistory() {
  const { data, error } = await getPendingOrderHistory();
  if (error) throw new Error(error);
  return data ?? [];
}

export function usePendingOrdersData({
  showError,
  showSuccess,
  onLicensesReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNotificationsReload,
  onNavigateToLicense,
  userSettings,
  includeHistory = false,
}) {
  const queryClient = useQueryClient();
  const { data, isLoading: pendingOrdersLoading, error: queryError, refetch } = useQuery({
    queryKey: queryKeys.pendingOrders,
    queryFn: fetchPendingOrders,
  });
  const pendingOrders = data ?? EMPTY_PENDING_ORDERS;

  const {
    data: historyData,
    isFetching: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: queryKeys.pendingOrderHistory,
    queryFn: fetchPendingOrderHistory,
    enabled: includeHistory,
  });
  const pendingOrderHistory = historyData ?? EMPTY_PENDING_ORDERS;

  const { data: licensesData } = useQuery({
    queryKey: queryKeys.licenses,
    queryFn: fetchLicensesData,
    select: getLicensesFromQueryData,
  });
  const licenses = licensesData ?? [];

  const [addingPOItems, setAddingPOItems] = useState(false);

  useEffect(() => {
    if (queryError) showError(queryError.message);
  }, [queryError, showError]);

  useEffect(() => {
    if (historyError) showError(historyError.message);
  }, [historyError, showError]);

  const handleCreatePendingOrder = useCallback(async (payload) => {
    const { items, quoteFile, ...headerPayload } = payload;
    const normalized = (items ?? [])
      .filter((item) => item.publisherName?.trim() && item.softwareDescription?.trim())
      .map((item) => ({
        publisherName: item.publisherName.trim(),
        softwareDescription: item.softwareDescription.trim(),
        licenseType: item.licenseType || null,
        licenseMetric: item.licenseMetric || null,
        portalUrl: item.portalUrl || null,
        maintenanceCoverage: item.maintenanceCoverage || null,
        maintenanceStartDate: item.maintenanceStartDate || null,
        maintenanceEndDate: item.maintenanceEndDate || null,
        maintenancePricingBasis: item.maintenancePricingBasis || null,
        maintenanceQuantity: parseLocalizedNumber(item.maintenanceQuantity, userSettings) ?? (item.maintenanceQuantity || null),
        maintenanceUnitPrice: parseLocalizedNumber(item.maintenanceUnitPrice, userSettings) ?? (item.maintenanceUnitPrice || null),
        maintenanceCost: parseLocalizedNumber(item.maintenanceCost, userSettings) ?? (item.maintenanceCost || null),
        quantity: parseLocalizedNumber(item.quantity, userSettings) ?? (item.quantity || null),
        quantityPerUnit: parseLocalizedNumber(item.quantityPerUnit, userSettings) ?? (item.quantityPerUnit || "1"),
        skuCode: item.skuCode || null,
        estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? (item.estimatedUnitPrice || null),
        estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? (item.estimatedTotalPrice || null),
        currency: item.currency || "EUR",
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        noticeDate: item.noticeDate || null,
        purchaseDate: item.purchaseDate || null,
        contractNumber: item.contractNumber || null,
        invoiceNumber: item.invoiceNumber || null,
        externalRef: item.externalRef || null,
        costCentre: item.costCentre || null,
        budgetOwnerEmail: item.budgetOwnerEmail || null,
        secondaryContacts: item.secondaryContacts || [],
        customFieldValues: item.customFieldValues || [],
        supplier: item.supplier || null,
        contactEmail: item.contactEmail || null,
        notes: item.notes || null,
      }));
    const { data, error } = await apiCreatePendingOrder({ ...headerPayload, items: normalized });
    if (error) { showError(error); return false; }
    if (quoteFile) {
      const { error: docError } = await uploadPendingOrderDocument(data.id, quoteFile);
      if (docError) {
        showError(`Partial completion: pending order ${data.poNumber || `#${data.id}`} was created, but document upload failed: ${docError}`);
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
        onPortfolioStateChange?.();
        return { ok: true, partial: true, data };
      }
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    onPortfolioStateChange?.();
    return { ok: true, partial: false, data };
  }, [showError, queryClient, onPortfolioStateChange, userSettings]);

  const handleUpdatePendingOrder = useCallback(async (id, payload) => {
    const { data, error } = await apiUpdatePendingOrder(id, payload);
    if (error) { showError(error); return false; }
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).map((o) => o.id === data.id ? data : o)
    );
    onPortfolioStateChange?.();
    return true;
  }, [showError, queryClient, onPortfolioStateChange]);

  const handleCancelPendingOrder = useCallback(async (id) => {
    const { error } = await apiCancelPendingOrder(id);
    if (error) { showError(error); return false; }
    await invalidateProcurementRenewalState(queryClient);
    onPortfolioStateChange?.();
    onRenewalsReload?.();
    showSuccess("Pending order moved to history.");
    return true;
  }, [showError, showSuccess, queryClient, onPortfolioStateChange, onRenewalsReload]);

  const handleConvertToLicense = useCallback(async (orderId, licenseData, file) => {
    const { data, error } = await convertPendingOrder(orderId, licenseData, file);
    if (error) { showError(error); return false; }
    const affectedLicenses = data;
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).filter((o) => o.id !== orderId)
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    onLicensesReload?.();
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    onNotificationsReload?.();
    const renewedCount = affectedLicenses.filter((al) => al.conversionType === "renewed").length;
    const newCount = affectedLicenses.filter((al) => al.conversionType === "new_purchase").length;
    const parts = [];
    if (renewedCount > 0) parts.push(`${renewedCount} license${renewedCount > 1 ? "s" : ""} renewed`);
    if (newCount > 0) parts.push(`${newCount} new license${newCount > 1 ? "s" : ""} created`);
    const toastMsg = parts.length > 0 ? parts.join(", ") : "Conversion complete";
    const firstNew = affectedLicenses.find((al) => al.conversionType === "renewed" || al.conversionType === "new_purchase");
    showSuccess(
      toastMsg,
      firstNew && onNavigateToLicense
        ? { label: "View License", onClick: () => onNavigateToLicense(firstNew.id) }
        : undefined,
    );
    return true;
  }, [showError, showSuccess, queryClient, onLicensesReload, onRenewalsReload, onPortfolioStateChange, onNotificationsReload, onNavigateToLicense]);

  const handleAddPOItems = useCallback(async (orderId, items) => {
    setAddingPOItems(true);
    const payload = items.map((item) => ({
      publisherName: item.publisherName.trim(),
      softwareDescription: item.softwareDescription.trim(),
      licenseType: item.licenseType || null,
      licenseMetric: item.licenseMetric || null,
      portalUrl: item.portalUrl || null,
      maintenanceCoverage: item.maintenanceCoverage || null,
      maintenanceStartDate: item.maintenanceStartDate || null,
      maintenanceEndDate: item.maintenanceEndDate || null,
      maintenancePricingBasis: item.maintenancePricingBasis || null,
      maintenanceQuantity: parseLocalizedNumber(item.maintenanceQuantity, userSettings) ?? (item.maintenanceQuantity || null),
      maintenanceUnitPrice: parseLocalizedNumber(item.maintenanceUnitPrice, userSettings) ?? (item.maintenanceUnitPrice || null),
      maintenanceCost: parseLocalizedNumber(item.maintenanceCost, userSettings) ?? (item.maintenanceCost || null),
      parentSourcingItemId: item.parentSourcingItemId || null,
      quantity: parseLocalizedNumber(item.quantity, userSettings) ?? (item.quantity || null),
      quantityPerUnit: parseLocalizedNumber(item.quantityPerUnit, userSettings) ?? (item.quantityPerUnit || "1"),
      skuCode: item.skuCode || null,
      estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? (item.estimatedUnitPrice || null),
      estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? (item.estimatedTotalPrice || null),
      currency: item.currency || "EUR",
      startDate: item.startDate || null,
      endDate: item.endDate || null,
      noticeDate: item.noticeDate || null,
      purchaseDate: item.purchaseDate || null,
      contractNumber: item.contractNumber || null,
      invoiceNumber: item.invoiceNumber || null,
      externalRef: item.externalRef || null,
      costCentre: item.costCentre || null,
      budgetOwnerEmail: item.budgetOwnerEmail || null,
      secondaryContacts: item.secondaryContacts || [],
      notes: item.notes || null,
      customFieldValues: item.customFieldValues || [],
      supplier: item.supplier || null,
      contactEmail: item.contactEmail || null,
    }));
    const { error } = await addItemsToPendingOrderBulk(orderId, payload);
    setAddingPOItems(false);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    showSuccess(`${items.length} item${items.length > 1 ? "s" : ""} added to pending order`);
    return true;
  }, [showError, showSuccess, queryClient, userSettings]);

  const handleUpdatePOItem = useCallback(async (orderId, itemId, payload) => {
    const { data, error } = await apiUpdatePendingOrderItem(orderId, itemId, payload);
    if (error) { showError(error); return false; }
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).map((order) => order.id === data.id ? data : order)
    );
    onPortfolioStateChange?.();
    return true;
  }, [showError, queryClient, onPortfolioStateChange]);

  const handleDeletePOItem = useCallback(async (orderId, itemId) => {
    const { data, error } = await apiDeletePendingOrderItem(orderId, itemId);
    if (error) { showError(error); return false; }
    if (data?.status === "cancelled") {
      await invalidateProcurementRenewalState(queryClient);
      onPortfolioStateChange?.();
      onRenewalsReload?.();
      showSuccess("Last PO line deleted. Pending order moved to history.");
      return true;
    }
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).map((order) => order.id === data.id ? data : order)
    );
    await invalidateProcurementRenewalState(queryClient);
    onPortfolioStateChange?.();
    onRenewalsReload?.();
    return true;
  }, [showError, showSuccess, queryClient, onPortfolioStateChange, onRenewalsReload]);

  const handleUploadPurchaseOrderDocument = useCallback(async (orderId, file) => {
    const { error } = await uploadPendingOrderDocument(orderId, file);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    showSuccess("Purchase order uploaded.");
    return true;
  }, [showError, showSuccess, queryClient]);

  const handleDownloadPurchaseOrderDocument = useCallback(async (document) => {
    const { error } = await downloadPendingOrderDocument(
      document.id,
      document.originalFilename ?? document.original_filename,
    );
    if (error) { showError(error); return false; }
    return true;
  }, [showError]);

  const handleDeletePurchaseOrderDocument = useCallback(async (document) => {
    const { error } = await deletePendingOrderDocument(document.id);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    showSuccess("Purchase order deleted.");
    return true;
  }, [showError, showSuccess, queryClient]);

  const handleDownloadSourcingQuote = useCallback(async (document) => {
    const { error } = await downloadSourcingQuoteDocument(
      document.id,
      document.originalFilename ?? document.original_filename,
    );
    if (error) { showError(error); return false; }
    return true;
  }, [showError]);

  const handleDeleteSourcingQuote = useCallback(async (document) => {
    const { error } = await deleteSourcingQuoteDocument(document.id);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcingHistory });
    showSuccess("Quote deleted.");
    return true;
  }, [showError, showSuccess, queryClient]);

  const handleRetryEvidenceTransfer = useCallback(async (orderId) => {
    const { error } = await retryPendingOrderEvidenceTransfer(orderId);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    showSuccess("Evidence transfer retry started.");
    return true;
  }, [showError, showSuccess, queryClient]);

  const handleBatchConvert = useCallback(async (orderId, items, poNumber, file = null) => {
    const { data, error } = await batchConvertPendingOrder(orderId, items, file);
    if (error) { showError(error); return false; }
    const affectedLicenses = data;
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).filter((o) => o.id !== orderId)
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    onLicensesReload?.();
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    const newCount = affectedLicenses.filter((al) => al.conversionType !== "renewed_predecessor").length;
    showSuccess(`${newCount} license${newCount !== 1 ? "s" : ""} created from ${poNumber ?? `Pending Order #${orderId}`}`);
    onNotificationsReload?.();
    return true;
  }, [showError, showSuccess, queryClient, onLicensesReload, onRenewalsReload, onPortfolioStateChange, onNotificationsReload]);

  const handleExportPendingOrdersCsv = useCallback(async () => {
    const { error } = await exportPendingOrdersCsv();
    if (error) showError(error);
  }, [showError]);

  return {
    pendingOrders,
    pendingOrderHistory,
    pendingOrdersLoading,
    historyLoading,
    refetch,
    refetchHistory,
    licenses,
    addingPOItems,
    handleCancelPendingOrder,
    handleCreatePendingOrder,
    handleUpdatePendingOrder,
    handleConvertToLicense,
    handleAddPOItems,
    handleUpdatePOItem,
    handleDeletePOItem,
    handleUploadPurchaseOrderDocument,
    handleDownloadPurchaseOrderDocument,
    handleDeletePurchaseOrderDocument,
    handleDownloadSourcingQuote,
    handleDeleteSourcingQuote,
    handleRetryEvidenceTransfer,
    handleBatchConvert,
    handleExportPendingOrdersCsv,
  };
}

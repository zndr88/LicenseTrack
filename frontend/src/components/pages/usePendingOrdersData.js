import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addItemsToPendingOrderBulk,
  batchConvertPendingOrder,
  cancelPendingOrder as apiCancelPendingOrder,
  convertPendingOrder,
  createPendingOrder as apiCreatePendingOrder,
  deletePendingOrder as apiDeletePendingOrder,
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
import { downloadSourcingQuoteDocument } from "../../api/sourcing.js";
import { queryKeys } from "../../queryKeys.js";
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
    const { data, error } = await apiCreatePendingOrder(headerPayload);
    if (error) { showError(error); return false; }
    if (items?.length > 0) {
      const normalized = items
        .filter((item) => item.publisherName?.trim() && item.softwareDescription?.trim())
        .map((item) => ({
          publisherName: item.publisherName.trim(),
          softwareDescription: item.softwareDescription.trim(),
          quantity: parseLocalizedNumber(item.quantity, userSettings) ?? (item.quantity || null),
          estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? (item.estimatedUnitPrice || null),
          estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? (item.estimatedTotalPrice || null),
          currency: item.currency || "EUR",
          supplier: item.supplier || null,
          contactEmail: item.contactEmail || null,
        }));
      if (normalized.length > 0) {
        const { error: itemsError } = await addItemsToPendingOrderBulk(data.id, normalized);
        if (itemsError) showError(`PO created but items could not be saved: ${itemsError}`);
      }
    }
    if (quoteFile) {
      const { error: docError } = await uploadPendingOrderDocument(data.id, quoteFile);
      if (docError) showError(`PO created but document upload failed: ${docError}`);
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    onPortfolioStateChange?.();
    return true;
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory }),
    ]);
    onPortfolioStateChange?.();
    onRenewalsReload?.();
    showSuccess("Pending order moved to history.");
    return true;
  }, [showError, showSuccess, queryClient, onPortfolioStateChange, onRenewalsReload]);

  const handleDeletePendingOrder = useCallback(async (id) => {
    const { error } = await apiDeletePendingOrder(id);
    if (error) { showError(error); return false; }
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).filter((o) => o.id !== id)
    );
    onPortfolioStateChange?.();
    onRenewalsReload?.();
    return true;
  }, [showError, queryClient, onPortfolioStateChange, onRenewalsReload]);

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
      maintenanceCoverage: item.maintenanceCoverage || null,
      maintenanceStartDate: item.maintenanceStartDate || null,
      maintenanceEndDate: item.maintenanceEndDate || null,
      maintenancePricingBasis: item.maintenancePricingBasis || null,
      maintenanceQuantity: parseLocalizedNumber(item.maintenanceQuantity, userSettings) ?? (item.maintenanceQuantity || null),
      maintenanceUnitPrice: parseLocalizedNumber(item.maintenanceUnitPrice, userSettings) ?? (item.maintenanceUnitPrice || null),
      maintenanceCost: parseLocalizedNumber(item.maintenanceCost, userSettings) ?? (item.maintenanceCost || null),
      parentSourcingItemId: item.parentSourcingItemId || null,
      quantity: parseLocalizedNumber(item.quantity, userSettings) ?? (item.quantity || null),
      estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? (item.estimatedUnitPrice || null),
      estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? (item.estimatedTotalPrice || null),
      currency: item.currency || "EUR",
      startDate: item.startDate || null,
      endDate: item.endDate || null,
      supplier: item.supplier || null,
      contactEmail: item.contactEmail || null,
    }));
    const { error } = await addItemsToPendingOrderBulk(orderId, payload);
    setAddingPOItems(false);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    showSuccess(`${items.length} item${items.length > 1 ? "s" : ""} added to PO`);
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory }),
      ]);
      onPortfolioStateChange?.();
      onRenewalsReload?.();
      showSuccess("Last PO line deleted. Pending order moved to history.");
      return true;
    }
    queryClient.setQueryData(queryKeys.pendingOrders, (prev) =>
      (prev ?? []).map((order) => order.id === data.id ? data : order)
    );
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

  const handleDownloadSourcingQuote = useCallback(async (document) => {
    const { error } = await downloadSourcingQuoteDocument(
      document.id,
      document.originalFilename ?? document.original_filename,
    );
    if (error) { showError(error); return false; }
    return true;
  }, [showError]);

  const handleRetryEvidenceTransfer = useCallback(async (orderId) => {
    const { error } = await retryPendingOrderEvidenceTransfer(orderId);
    if (error) { showError(error); return false; }
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory });
    showSuccess("Evidence transfer retry started.");
    return true;
  }, [showError, showSuccess, queryClient]);

  const handleBatchConvert = useCallback(async (orderId, items, poNumber) => {
    const { data, error } = await batchConvertPendingOrder(orderId, items);
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
    showSuccess(`${newCount} license${newCount !== 1 ? "s" : ""} created from PO ${poNumber ?? orderId}`);
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
    handleDeletePendingOrder,
    handleConvertToLicense,
    handleAddPOItems,
    handleUpdatePOItem,
    handleDeletePOItem,
    handleUploadPurchaseOrderDocument,
    handleDownloadPurchaseOrderDocument,
    handleDownloadSourcingQuote,
    handleRetryEvidenceTransfer,
    handleBatchConvert,
    handleExportPendingOrdersCsv,
  };
}

import { useCallback } from "react";
import { queryKeys } from "../../../queryKeys.js";
import {
  addSourcingRequestItem,
  cancelSourcingRequest as apiCancelSourcingRequest,
  convertFreewareSourcingItem as apiConvertFreewareSourcingItem,
  convertFreewareSourcingRequest as apiConvertFreewareSourcingRequest,
  convertSourcingRequest as apiConvertSourcingRequest,
  createSourcingRequest,
  deleteSourcingItem as apiDeleteSourcingItem,
  deleteSourcingRequest as apiDeleteSourcingRequest,
  exportSourcingCsv,
  updateSourcingItem as apiUpdateSourcingItem,
  updateSourcingRequest as apiUpdateSourcingRequest,
  uploadSourcingQuoteDocument,
} from "../../../api/sourcing.js";
import { invalidateProcurementRenewalState } from "../../../queryInvalidation.js";
import { pendingOrderLabel } from "../../../utils/procurementLabels.js";

function invalidateSourcingCaches(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcing }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcingHistory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcingItems }),
  ]);
}

export function useSourcingActions({
  queryClient,
  showToast,
  setExpandedRequestId,
  onPendingOrdersReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNavigateToPendingOrder,
  onNavigateToLicense,
}) {
  const handleCreateSourcingItem = useCallback(async (payload, requestId = null) => {
    const { data: created, error } = requestId
      ? await addSourcingRequestItem(requestId, payload)
      : await createSourcingRequest({
          supplier: payload.supplier || null,
          contactEmail: payload.contactEmail || null,
          notes: payload.notes || null,
          items: [payload],
        });
    if (error) { showToast(error, "error"); return false; }
    await invalidateSourcingCaches(queryClient);
    if (created?.id) setExpandedRequestId(created.id);
    return created ?? true;
  }, [showToast, queryClient, setExpandedRequestId]);

  const handleUpdateSourcingItem = useCallback(async (id, payload) => {
    const { error } = await apiUpdateSourcingItem(id, payload);
    if (error) { showToast(error, "error"); return false; }
    await invalidateSourcingCaches(queryClient);
    return true;
  }, [showToast, queryClient]);

  const handleUpdateSourcingRequest = useCallback(async (requestId, payload) => {
    const { error } = await apiUpdateSourcingRequest(requestId, {
      supplier: payload.supplier || null,
      contactEmail: payload.contactEmail || null,
      notes: payload.notes || null,
      items: payload.items ?? [],
    });
    if (error) { showToast(error, "error"); return false; }
    await invalidateSourcingCaches(queryClient);
    showToast("Sourcing request updated.", "success");
    return true;
  }, [showToast, queryClient]);

  const handleDeleteSourcingItem = useCallback(async (id) => {
    const { error } = await apiDeleteSourcingItem(id);
    if (error) { showToast(error, "error"); return false; }
    await invalidateProcurementRenewalState(queryClient);
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange]);

  const handleDeleteSourcingRequest = useCallback(async (request) => {
    const { error } = await apiDeleteSourcingRequest(request.id);
    if (error) { showToast(error, "error"); return false; }
    await invalidateProcurementRenewalState(queryClient);
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    showToast("Sourcing request deleted. Linked renewal processing was cancelled where applicable.", "success");
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange]);

  const handleCancelSourcingRequest = useCallback(async (request) => {
    const { error } = await apiCancelSourcingRequest(request.id);
    if (error) { showToast(error, "error"); return false; }
    await invalidateProcurementRenewalState(queryClient);
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    showToast("Sourcing request moved to history.", "success");
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange]);

  const handleConvertSourcingRequest = useCallback(async (id, opts) => {
    const { data: order, error } = await apiConvertSourcingRequest(id, opts);
    if (error) { showToast(error, "error"); return false; }
    await invalidateSourcingCaches(queryClient);
    onPendingOrdersReload?.();
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    const directCount = order.directRegistryCount ?? 0;
    const orderLabel = pendingOrderLabel(order);
    showToast(
      directCount
        ? `${directCount} line${directCount === 1 ? "" : "s"} added to the Registry; purchase lines moved to ${orderLabel}.`
        : `Converted to ${orderLabel}`,
      "success",
      onNavigateToPendingOrder
        ? { label: "View Order", onClick: () => onNavigateToPendingOrder(order.id) }
        : null
    );
    return true;
  }, [showToast, queryClient, onPendingOrdersReload, onRenewalsReload, onPortfolioStateChange, onNavigateToPendingOrder]);

  const handleConvertFreeware = useCallback(async ({ itemId = null, requestId = null }) => {
    const { data, error } = itemId
      ? await apiConvertFreewareSourcingItem(itemId)
      : await apiConvertFreewareSourcingRequest(requestId);
    if (error) { showToast(error, "error"); return false; }

    const licenses = Array.isArray(data) ? data : [data];
    await invalidateSourcingCaches(queryClient);
    await queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
    onRenewalsReload?.();
    onPortfolioStateChange?.();

    const first = licenses[0];
    showToast(
      `${licenses.length} Freeware / Open Source license${licenses.length === 1 ? "" : "s"} added to the Registry.`,
      "success",
      licenses.length === 1 && onNavigateToLicense
        ? { label: "View License", onClick: () => onNavigateToLicense(first.id) }
        : null
    );
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange, onNavigateToLicense]);

  const handleExportSourcingCsv = useCallback(async () => {
    const { error } = await exportSourcingCsv();
    if (error) showToast(error, "error");
  }, [showToast]);

  const handleCreateSourcingRequest = useCallback(async (payload) => {
    const { quoteFile, ...apiPayload } = payload;
    const { data: created, error } = await createSourcingRequest(apiPayload);
    if (error) { showToast(error, "error"); return false; }
    if (created?.id) {
      setExpandedRequestId(created.id);
      if (quoteFile) {
        const { error: qErr } = await uploadSourcingQuoteDocument(created.id, quoteFile);
        if (qErr) showToast(`Request created but quote upload failed: ${qErr}`, "warning");
      }
    }
    await invalidateSourcingCaches(queryClient);
    showToast(`Sourcing request created with ${apiPayload.items.length} line${apiPayload.items.length === 1 ? "" : "s"}.`, "success");
    return true;
  }, [showToast, queryClient, setExpandedRequestId]);

  return {
    handleCreateSourcingItem,
    handleCreateSourcingRequest,
    handleUpdateSourcingItem,
    handleUpdateSourcingRequest,
    handleDeleteSourcingItem,
    handleDeleteSourcingRequest,
    handleCancelSourcingRequest,
    handleConvertSourcingRequest,
    handleConvertFreeware,
    handleExportSourcingCsv,
  };
}

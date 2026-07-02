import { useCallback } from "react";
import { queryKeys } from "../../../queryKeys.js";
import {
  addSourcingRequestItem,
  convertSourcingRequest as apiConvertSourcingRequest,
  createSourcingRequest,
  deleteSourcingItem as apiDeleteSourcingItem,
  deleteSourcingRequest as apiDeleteSourcingRequest,
  exportSourcingCsv,
  updateSourcingItem as apiUpdateSourcingItem,
  uploadSourcingQuoteDocument,
} from "../../../api/sourcing.js";

export function useSourcingActions({
  queryClient,
  showToast,
  setExpandedRequestId,
  onPendingOrdersReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNavigateToPendingOrder,
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    if (created?.id) setExpandedRequestId(created.id);
    return true;
  }, [showToast, queryClient, setExpandedRequestId]);

  const handleUpdateSourcingItem = useCallback(async (id, payload) => {
    const { error } = await apiUpdateSourcingItem(id, payload);
    if (error) { showToast(error, "error"); return false; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    return true;
  }, [showToast, queryClient]);

  const handleDeleteSourcingItem = useCallback(async (id) => {
    const { error } = await apiDeleteSourcingItem(id);
    if (error) { showToast(error, "error"); return false; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange]);

  const handleDeleteSourcingRequest = useCallback(async (request) => {
    const { error } = await apiDeleteSourcingRequest(request.id);
    if (error) { showToast(error, "error"); return false; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    showToast("Sourcing request deleted. Linked renewal processing was cancelled where applicable.", "success");
    return true;
  }, [showToast, queryClient, onRenewalsReload, onPortfolioStateChange]);

  const handleConvertSourcingRequest = useCallback(async (id, opts) => {
    const { data: order, error } = await apiConvertSourcingRequest(id, opts);
    if (error) { showToast(error, "error"); return false; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    onPendingOrdersReload?.();
    onRenewalsReload?.();
    onPortfolioStateChange?.();
    showToast(
      `Converted to Pending Order ${order.poNumber}`,
      "success",
      onNavigateToPendingOrder
        ? { label: "View Order", onClick: () => onNavigateToPendingOrder(order.id) }
        : null
    );
    return true;
  }, [showToast, queryClient, onPendingOrdersReload, onRenewalsReload, onPortfolioStateChange, onNavigateToPendingOrder]);

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
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    showToast(`Sourcing request created with ${apiPayload.items.length} line${apiPayload.items.length === 1 ? "" : "s"}.`, "success");
    return true;
  }, [showToast, queryClient, setExpandedRequestId]);

  return {
    handleCreateSourcingItem,
    handleCreateSourcingRequest,
    handleUpdateSourcingItem,
    handleDeleteSourcingItem,
    handleDeleteSourcingRequest,
    handleConvertSourcingRequest,
    handleExportSourcingCsv,
  };
}

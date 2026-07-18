import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  bulkDeleteLicenses,
  deleteLicense,
  getLicense,
  patchLicenseField,
  updateLicense,
} from "../../../api/licenses.js";
import { queryKeys } from "../../../queryKeys.js";
import { invalidateNotifications } from "../../../queryInvalidation.js";
import { normalizeLicense } from "../../../utils/helpers.js";
import { updateLicensesInQueryData } from "../../../utils/licenseQueryData.js";
import { useRenewalWorkflowActions } from "../../../hooks/useRenewalWorkflowActions.js";

export function useLicenseActions({
  selectedId,
  selectedIds,
  setSelectedId,
  setSelectedIds,
  setShowBulkDeleteConfirm,
  showError,
  showToast,
  onPortfolioStateChange,
  onSourcingCreated,
}) {
  const queryClient = useQueryClient();

  const updateLicensesInCache = useCallback((updater) => {
    queryClient.setQueryData(queryKeys.licenses, (old) => {
      return updateLicensesInQueryData(old, updater);
    });
  }, [queryClient]);

  const {
    startRenewal,
    startRenewalBundle,
    cancelRenewal: cancelRenewalWorkflow,
  } = useRenewalWorkflowActions({
    updateLicensesInCache,
    showError,
    showToast,
    onPortfolioStateChange,
    onSourcingCreated,
  });

  const handleLicenseUpdate = useCallback(async (id, upd) => {
    const previous = queryClient.getQueryData(queryKeys.licenses);
    updateLicensesInCache((ls) => ls.map((l) => l.id === id ? { ...l, ...upd } : l));
    if (upd.documents || "documentCount" in upd || "renewedFromId" in upd) {
      if (upd.documents || "documentCount" in upd) {
        queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
      }
      return true;
    }
    const apiPayload = { ...upd };
    if ("retired" in apiPayload) {
      apiPayload.isRetired = apiPayload.retired;
      delete apiPayload.retired;
    }
    const { error } = await updateLicense(id, apiPayload);
    if (error) {
      if (previous) queryClient.setQueryData(queryKeys.licenses, previous);
      showError(error);
      return false;
    }
    const { data: fresh } = await getLicense(id);
    if (fresh) updateLicensesInCache((ls) => ls.map((l) => l.id === id ? normalizeLicense(fresh) : l));
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
    onPortfolioStateChange?.();
    invalidateNotifications(queryClient);
    return true;
  }, [queryClient, updateLicensesInCache, onPortfolioStateChange, showError]);

  const handleLicenseFieldPatch = useCallback(async (id, field, value) => {
    const previous = queryClient.getQueryData(queryKeys.licenses);
    updateLicensesInCache((ls) => ls.map((l) => l.id === id ? { ...l, [field]: value } : l));

    const { data, error } = await patchLicenseField(id, field, value);
    if (error) {
      if (previous) queryClient.setQueryData(queryKeys.licenses, previous);
      showError(error);
      return { ok: false, error };
    }

    if (data) {
      updateLicensesInCache((ls) => ls.map((l) => l.id === id ? normalizeLicense(data) : l));
    } else {
      const { data: fresh } = await getLicense(id);
      if (fresh) updateLicensesInCache((ls) => ls.map((l) => l.id === id ? normalizeLicense(fresh) : l));
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
    onPortfolioStateChange?.();
    invalidateNotifications(queryClient);
    return { ok: true, error: null };
  }, [queryClient, updateLicensesInCache, onPortfolioStateChange, showError]);

  const handleLicenseDelete = useCallback(async (id) => {
    const { error } = await deleteLicense(id);
    if (error) { showError(error); return; }
    updateLicensesInCache((ls) => ls.filter((l) => l.id !== id));
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
    onPortfolioStateChange?.();
    invalidateNotifications(queryClient);
  }, [updateLicensesInCache, onPortfolioStateChange, showError, queryClient]);

  const handleCreateRenewal = useCallback(async (licenseId) => {
    return startRenewal(licenseId);
  }, [startRenewal]);

  const handleCreateRenewalBundle = useCallback(async (licenseIds) => {
    return startRenewalBundle(licenseIds);
  }, [startRenewalBundle]);

  const handleCancelRenewal = useCallback(async (licenseId) => {
    const result = await cancelRenewalWorkflow(licenseId);
    return result.ok;
  }, [cancelRenewalWorkflow]);

  const handleBulkDelete = useCallback(async () => {
    setShowBulkDeleteConfirm(false);
    const ids = [...selectedIds];
    const { error } = await bulkDeleteLicenses(ids);
    if (error) { showError(error); return; }
    updateLicensesInCache((ls) => ls.filter((l) => !ids.includes(l.id)));
    setSelectedIds(new Set());
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
    onPortfolioStateChange?.();
    invalidateNotifications(queryClient);
  }, [
    updateLicensesInCache,
    onPortfolioStateChange,
    selectedId,
    selectedIds,
    setSelectedId,
    setSelectedIds,
    setShowBulkDeleteConfirm,
    showError,
    queryClient,
  ]);

  return {
    handleLicenseUpdate,
    handleLicenseFieldPatch,
    handleLicenseDelete,
    handleCreateRenewal,
    handleCreateRenewalBundle,
    handleCancelRenewal,
    handleBulkDelete,
  };
}

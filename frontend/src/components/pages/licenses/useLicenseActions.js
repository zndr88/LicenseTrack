import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  bulkDeleteLicenses,
  deleteLicense,
  getLicense,
  patchLicenseField,
  setPoTotalOverride as setPoTotalOverrideApi,
  clearPoTotalOverride as clearPoTotalOverrideApi,
  unlinkExistingSuccessor,
  updateLicense,
} from "../../../api/licenses.js";
import { queryKeys } from "../../../queryKeys.js";
import { invalidateNotifications, invalidateRenewalWorkflow } from "../../../queryInvalidation.js";
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

  const handlePoTotalOverride = useCallback(async (id, value) => {
    const apiCall = value === null ? clearPoTotalOverrideApi(id) : setPoTotalOverrideApi(id, value);
    const { data, error } = await apiCall;
    if (error) {
      showError(error);
      return false;
    }
    if (data?.poNumber) {
      updateLicensesInCache((ls) => ls.map((license) => (
        license.poNumber === data.poNumber
          ? { ...license, poTotalOverride: value }
          : license
      )));
    }
    return true;
  }, [updateLicensesInCache, showError]);

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

  const handleUnlinkExistingSuccessor = useCallback(async (licenseId) => {
    const { data, error } = await unlinkExistingSuccessor(licenseId);
    if (error) {
      showError(error);
      return { ok: false, error };
    }
    updateLicensesInCache((licenses) => licenses.map((license) => {
      if (license.id === data.predecessor.id) return normalizeLicense(data.predecessor);
      if (license.id === data.successor.id) return normalizeLicense(data.successor);
      return license;
    }));
    invalidateRenewalWorkflow(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseProcurementTrail(data.predecessor.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseProcurementTrail(data.successor.id) });
    onPortfolioStateChange?.();
    return { ok: true, data };
  }, [onPortfolioStateChange, queryClient, showError, updateLicensesInCache]);

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
    handlePoTotalOverride,
    handleLicenseDelete,
    handleCreateRenewal,
    handleCreateRenewalBundle,
    handleCancelRenewal,
    handleUnlinkExistingSuccessor,
    handleBulkDelete,
  };
}

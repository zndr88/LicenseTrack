import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cancelRenewal, initiateRenewal } from "../api/licenses.js";
import { queryKeys } from "../queryKeys.js";
import { invalidateRenewalWorkflow } from "../queryInvalidation.js";
import { normalizeLicense } from "../utils/helpers.js";

const PO_CANCEL_WARNING =
  "Renewal cancelled. A pending order already existed " +
  "for this renewal and has NOT been removed - please " +
  "handle it manually in Pending Orders.";

export function updateLicensesQueryCache(queryClient, updater) {
  queryClient.setQueryData(queryKeys.licenses, (old) => {
    if (!old) return old;
    return { ...old, licenses: updater(old.licenses) };
  });
}

export function useRenewalWorkflowActions({
  updateLicensesInCache,
  showError,
  showToast,
  onSourcingCreated,
  onPortfolioStateChange,
  onRenewalStarted,
} = {}) {
  const queryClient = useQueryClient();

  const updateLicenseCache = useCallback((updater) => {
    if (updateLicensesInCache) {
      updateLicensesInCache(updater);
      return;
    }
    updateLicensesQueryCache(queryClient, updater);
  }, [queryClient, updateLicensesInCache]);

  const refreshWorkflow = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
    onPortfolioStateChange?.();
    invalidateRenewalWorkflow(queryClient);
  }, [onPortfolioStateChange, queryClient]);

  const startRenewal = useCallback(async (licenseId) => {
    const { data, error } = await initiateRenewal(licenseId);
    if (error) {
      showError?.(error);
      return { ok: false, error };
    }

    if (data?.license) {
      updateLicenseCache((licenses) => licenses.map((license) =>
        license.id === data.license.id ? normalizeLicense(data.license) : license
      ));
    }
    if (data?.sourcingItem) {
      queryClient.setQueryData(queryKeys.sourcingItems, (prev) => [data.sourcingItem, ...(prev ?? [])]);
    }

    onSourcingCreated?.(data?.sourcingItem);
    onRenewalStarted?.(data);
    refreshWorkflow();
    return { ok: true, data };
  }, [
    onRenewalStarted,
    onSourcingCreated,
    queryClient,
    refreshWorkflow,
    showError,
    updateLicenseCache,
  ]);

  const cancelRenewalWorkflow = useCallback(async (licenseId) => {
    const { data, error } = await cancelRenewal(licenseId);
    if (error) {
      showError?.(error);
      return { ok: false, error };
    }

    if (data?.license) {
      updateLicenseCache((licenses) => licenses.map((license) =>
        license.id === licenseId ? normalizeLicense(data.license) : license
      ));
    }

    if (data?.poWarning) {
      showError?.(PO_CANCEL_WARNING);
    } else {
      showToast?.("Renewal cancelled.", "info");
    }
    refreshWorkflow();
    return { ok: true, data };
  }, [refreshWorkflow, showError, showToast, updateLicenseCache]);

  return {
    startRenewal,
    cancelRenewal: cancelRenewalWorkflow,
  };
}

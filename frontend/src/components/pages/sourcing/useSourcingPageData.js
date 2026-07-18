import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSourcingRequestHistory, getSourcingRequests } from "../../../api/sourcing.js";
import { queryKeys } from "../../../queryKeys.js";
import { fetchLicensesData } from "../licenses/useLicensesPageData.js";
import { getLicensesFromQueryData } from "../../../utils/licenseQueryData.js";

const EMPTY_SOURCING = [];

async function fetchSourcingRequests() {
  const { data, error } = await getSourcingRequests();
  if (error) throw new Error(error);
  return data ?? [];
}

async function fetchSourcingRequestHistory() {
  const { data, error } = await getSourcingRequestHistory();
  if (error) throw new Error(error);
  return data ?? [];
}

export function useSourcingPageData({ showToast, includeHistory = false }) {
  const { data, isLoading: sourcingLoading, error: queryError, refetch } = useQuery({
    queryKey: queryKeys.sourcing,
    queryFn: fetchSourcingRequests,
  });
  const sourcingRequests = data ?? EMPTY_SOURCING;
  const sourcingItems = useMemo(
    () => sourcingRequests.flatMap((request) => request.items ?? []),
    [sourcingRequests]
  );

  const { data: licensesData, error: licensesError } = useQuery({
    queryKey: queryKeys.licenses,
    queryFn: fetchLicensesData,
  });
  const licenses = getLicensesFromQueryData(licensesData);

  const {
    data: historyData,
    isFetching: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: queryKeys.sourcingHistory,
    queryFn: fetchSourcingRequestHistory,
    enabled: includeHistory,
  });
  const sourcingHistoryRequests = historyData ?? EMPTY_SOURCING;

  useEffect(() => {
    if (queryError) showToast(queryError.message, "error");
  }, [queryError, showToast]);

  useEffect(() => {
    if (licensesError) showToast(licensesError.message, "error");
  }, [licensesError, showToast]);

  useEffect(() => {
    if (historyError) showToast(historyError.message, "error");
  }, [historyError, showToast]);

  return {
    historyLoading,
    licenses,
    refetchHistory,
    sourcingItems,
    sourcingHistoryRequests,
    sourcingLoading,
    sourcingRequests,
    refetch,
  };
}

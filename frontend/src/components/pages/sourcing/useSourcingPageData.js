import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSourcingRequests } from "../../../api/sourcing.js";
import { queryKeys } from "../../../queryKeys.js";
import { fetchLicensesData } from "../licenses/useLicensesPageData.js";
import { getLicensesFromQueryData } from "../../../utils/licenseQueryData.js";

const EMPTY_SOURCING = [];

async function fetchSourcingRequests() {
  const { data, error } = await getSourcingRequests();
  if (error) throw new Error(error);
  return data ?? [];
}

export function useSourcingPageData({ showToast }) {
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

  useEffect(() => {
    if (queryError) showToast(queryError.message, "error");
  }, [queryError, showToast]);

  useEffect(() => {
    if (licensesError) showToast(licensesError.message, "error");
  }, [licensesError, showToast]);

  return {
    licenses,
    sourcingItems,
    sourcingLoading,
    sourcingRequests,
    refetch,
  };
}

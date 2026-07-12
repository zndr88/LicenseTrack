import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLicenses } from "../../../api/licenses.js";
import { getSourcingRequests } from "../../../api/sourcing.js";
import { queryKeys } from "../../../queryKeys.js";
import { normalizeLicense } from "../../../utils/helpers.js";

const EMPTY_SOURCING = [];

async function fetchSourcingRequests() {
  const { data, error } = await getSourcingRequests();
  if (error) throw new Error(error);
  return data ?? [];
}

async function fetchLicenses() {
  const { data, error } = await getLicenses({ includeRetired: true });
  if (error) throw new Error(error);
  return (data ?? []).map(normalizeLicense);
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

  const { data: licenses = [], error: licensesError } = useQuery({
    queryKey: queryKeys.licenses,
    queryFn: fetchLicenses,
  });

  useEffect(() => {
    if (queryError) showToast(queryError.message, "error");
  }, [queryError]); // eslint-disable-line react-hooks/exhaustive-deps -- showToast is stable

  useEffect(() => {
    if (licensesError) showToast(licensesError.message, "error");
  }, [licensesError]); // eslint-disable-line react-hooks/exhaustive-deps -- showToast is stable

  return {
    licenses,
    sourcingItems,
    sourcingLoading,
    sourcingRequests,
    refetch,
  };
}

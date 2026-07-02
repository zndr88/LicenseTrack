import { useEffect, useMemo, useState } from "react";
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

  const [licenses, setLicenses] = useState([]);

  useEffect(() => {
    if (queryError) showToast(queryError.message, "error");
  }, [queryError]); // eslint-disable-line react-hooks/exhaustive-deps -- showToast is stable

  useEffect(() => {
    getLicenses({ includeRetired: true }).then(({ data: licenseData }) => {
      if (licenseData) setLicenses((licenseData ?? []).map(normalizeLicense));
    });
  }, []);

  return {
    licenses,
    sourcingItems,
    sourcingLoading,
    sourcingRequests,
    refetch,
  };
}

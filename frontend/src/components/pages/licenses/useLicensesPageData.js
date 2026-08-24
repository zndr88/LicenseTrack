import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getContracts } from "../../../api/contracts.js";
import { getLicenses, getStats } from "../../../api/licenses.js";
import { getPendingOrders } from "../../../api/pendingOrders.js";
import { getSourcingItems } from "../../../api/sourcing.js";
import { listCustomFields } from "../../../api/settings.js";
import { queryKeys } from "../../../queryKeys.js";
import { normalizeLicense } from "../../../utils/helpers.js";
import {
  getCustomFieldValuesMapFromQueryData,
  getLicensesFromQueryData,
} from "../../../utils/licenseQueryData.js";

const EMPTY_ARRAY = [];

export async function fetchLicensesData() {
  const { data, error } = await getLicenses({ includeRetired: true });
  if (error) throw new Error(error);
  const normalized = (data ?? []).map(normalizeLicense);
  const valMap = new Map();
  for (const license of normalized) {
    const values = license.customFields ?? [];
    if (values.length > 0) valMap.set(license.id, values);
  }
  return { licenses: normalized, customFieldValuesMap: valMap };
}

async function fetchLicenseStats() {
  const { data, error } = await getStats();
  if (error) throw new Error(error);
  return data ?? null;
}

async function fetchSourcingItems() {
  const { data, error } = await getSourcingItems();
  if (error) throw new Error(error);
  return data ?? EMPTY_ARRAY;
}

async function fetchPendingOrders() {
  const { data, error } = await getPendingOrders();
  if (error) throw new Error(error);
  return data ?? EMPTY_ARRAY;
}

async function fetchContracts() {
  const { data, error } = await getContracts();
  if (error) throw new Error(error);
  return data ?? EMPTY_ARRAY;
}

async function fetchCustomFieldDefs() {
  const { data, error } = await listCustomFields();
  if (error) throw new Error(error);
  return data ?? EMPTY_ARRAY;
}

export function useLicensesPageData({ showError, includeContracts = false }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.licenses,
    queryFn: fetchLicensesData,
  });

  useEffect(() => {
    if (error) showError(error.message);
  }, [error, showError]);

  const licenses = getLicensesFromQueryData(data);
  const customFieldValuesMap = getCustomFieldValuesMapFromQueryData(data);

  const statsQuery = useQuery({
    queryKey: queryKeys.licenseStats,
    queryFn: fetchLicenseStats,
  });

  const sourcingQuery = useQuery({
    queryKey: queryKeys.sourcingItems,
    queryFn: fetchSourcingItems,
  });

  const pendingOrdersQuery = useQuery({
    queryKey: queryKeys.pendingOrders,
    queryFn: fetchPendingOrders,
  });

  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts,
    queryFn: fetchContracts,
    enabled: includeContracts,
  });

  const customFieldDefsQuery = useQuery({
    queryKey: queryKeys.customFieldDefs,
    queryFn: fetchCustomFieldDefs,
  });

  const auxiliaryIssues = useMemo(() => [
    { key: "stats", label: "portfolio statistics", query: statsQuery },
    { key: "sourcing", label: "sourcing totals", query: sourcingQuery },
    { key: "pendingOrders", label: "pending-order totals", query: pendingOrdersQuery },
    ...(includeContracts ? [{ key: "contracts", label: "contracts", query: contractsQuery }] : []),
    { key: "customFields", label: "custom-field definitions", query: customFieldDefsQuery },
  ].filter(({ query }) => query.error).map(({ key, label, query }) => ({
    key,
    label,
    message: query.error.message,
    hasRetainedData: query.data !== undefined,
    retry: query.refetch,
  })), [
    contractsQuery,
    customFieldDefsQuery,
    includeContracts,
    pendingOrdersQuery,
    sourcingQuery,
    statsQuery,
  ]);

  const retryAuxiliaryData = useCallback(
    () => Promise.all(auxiliaryIssues.map((issue) => issue.retry())),
    [auxiliaryIssues],
  );

  return {
    licenses,
    licensesLoading: isLoading,
    licensesError: error?.message ?? null,
    loadLicenses: refetch,
    apiStats: statsQuery.data ?? null,
    sourcingItems: sourcingQuery.data ?? EMPTY_ARRAY,
    pendingOrders: pendingOrdersQuery.data ?? EMPTY_ARRAY,
    contracts: contractsQuery.data ?? EMPTY_ARRAY,
    customFieldDefs: customFieldDefsQuery.data ?? EMPTY_ARRAY,
    customFieldValuesMap,
    auxiliaryIssues,
    retryAuxiliaryData,
    sourcingTotalsUnavailable: Boolean(sourcingQuery.error && sourcingQuery.data === undefined),
    pendingOrderTotalsUnavailable: Boolean(pendingOrdersQuery.error && pendingOrdersQuery.data === undefined),
  };
}

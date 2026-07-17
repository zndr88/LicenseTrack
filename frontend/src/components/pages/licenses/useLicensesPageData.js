import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getContracts } from "../../../api/contracts.js";
import { getLicenses, getAllCustomFieldValues, getStats } from "../../../api/licenses.js";
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
  const { data: valData } = await getAllCustomFieldValues();
  const valMap = new Map();
  if (valData?.values) {
    for (const val of valData.values) {
      if (!valMap.has(val.licenseId)) valMap.set(val.licenseId, []);
      valMap.get(val.licenseId).push(val);
    }
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

  const { data: apiStats = null } = useQuery({
    queryKey: queryKeys.licenseStats,
    queryFn: fetchLicenseStats,
  });

  const { data: sourcingItems = EMPTY_ARRAY } = useQuery({
    queryKey: queryKeys.sourcingItems,
    queryFn: fetchSourcingItems,
  });

  const { data: pendingOrders = EMPTY_ARRAY } = useQuery({
    queryKey: queryKeys.pendingOrders,
    queryFn: fetchPendingOrders,
  });

  const { data: contracts = EMPTY_ARRAY } = useQuery({
    queryKey: queryKeys.contracts,
    queryFn: fetchContracts,
    enabled: includeContracts,
  });

  const { data: customFieldDefs = EMPTY_ARRAY } = useQuery({
    queryKey: queryKeys.customFieldDefs,
    queryFn: fetchCustomFieldDefs,
  });

  return {
    licenses,
    licensesLoading: isLoading,
    licensesError: error?.message ?? null,
    loadLicenses: refetch,
    apiStats,
    sourcingItems,
    pendingOrders,
    contracts,
    customFieldDefs,
    customFieldValuesMap,
  };
}

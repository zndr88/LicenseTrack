import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys.js";
import { fetchLicensesData } from "../components/pages/licenses/useLicensesPageData.js";
import { getLicensesFromQueryData } from "../utils/licenseQueryData.js";

const EMPTY = [];

// The full license list (including retired) from the shared licenses cache.
// Dialogs use this instead of receiving the list as a prop, so no caller can
// forget to pass it.
export function useAllLicenses() {
  const query = useQuery({ queryKey: queryKeys.licenses, queryFn: fetchLicensesData });
  return { licenses: getLicensesFromQueryData(query.data) ?? EMPTY, isLoading: query.isLoading };
}

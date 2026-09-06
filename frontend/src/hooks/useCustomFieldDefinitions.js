import { useQuery } from "@tanstack/react-query";
import { listCustomFields } from "../api/settings.js";
import { queryKeys } from "../queryKeys.js";

const EMPTY_DEFINITIONS = [];

export async function fetchCustomFieldDefinitions() {
  const { data, error } = await listCustomFields();
  if (error) throw new Error(error);
  return Array.isArray(data) ? data : EMPTY_DEFINITIONS;
}

export function useCustomFieldDefinitions() {
  const query = useQuery({
    queryKey: queryKeys.customFieldDefs,
    queryFn: fetchCustomFieldDefinitions,
  });

  return {
    definitions: query.data ?? EMPTY_DEFINITIONS,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

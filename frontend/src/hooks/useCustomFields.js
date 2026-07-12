import { useCallback, useState, useEffect, useRef } from "react";
import { listCustomFields } from "../api/settings.js";
import { getCustomFieldValues } from "../api/licenses.js";

export function useCustomFields(licenseId) {
  const [customFieldValues, setCustomFieldValues] = useState([]);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const refreshRequestRef = useRef(0);

  const refreshCustomFields = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    if (!licenseId) {
      setCustomFieldValues([]);
      setCustomFieldDefs([]);
      setCustomFieldsLoading(false);
      return [];
    }
    setCustomFieldsLoading(true);
    const [defsResult, valsResult] = await Promise.all([
      listCustomFields(),
      getCustomFieldValues(licenseId),
    ]);
    if (refreshRequestRef.current !== requestId) return [];
    setCustomFieldsLoading(false);
    if (!defsResult.error && defsResult.data) setCustomFieldDefs(defsResult.data);
    if (!valsResult.error && valsResult.data) setCustomFieldValues(valsResult.data.values ?? []);
    return valsResult.data?.values ?? [];
  }, [licenseId]);

  useEffect(() => {
    refreshCustomFields();
  }, [refreshCustomFields]);

  const customFieldsBySection = customFieldDefs.reduce((acc, def) => {
    const key = def.section ?? "__catchall__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(def);
    return acc;
  }, {});

  return {
    customFieldValues,
    setCustomFieldValues,
    refreshCustomFields,
    customFieldDefs,
    customFieldsBySection,
    customFieldsLoading,
  };
}

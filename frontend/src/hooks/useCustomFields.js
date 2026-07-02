import { useCallback, useState, useEffect } from "react";
import { listCustomFields } from "../api/settings.js";
import { getCustomFieldValues } from "../api/licenses.js";

export function useCustomFields(licenseId) {
  const [customFieldValues, setCustomFieldValues] = useState([]);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);

  const refreshCustomFields = useCallback(async () => {
    if (!licenseId) return;
    setCustomFieldsLoading(true);
    const [defsResult, valsResult] = await Promise.all([
      listCustomFields(),
      getCustomFieldValues(licenseId),
    ]);
    setCustomFieldsLoading(false);
    if (!defsResult.error && defsResult.data) setCustomFieldDefs(defsResult.data);
    if (!valsResult.error && valsResult.data) setCustomFieldValues(valsResult.data.values ?? []);
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

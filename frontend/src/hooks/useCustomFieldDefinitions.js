import { useEffect, useState } from "react";
import { listCustomFields } from "../api/settings.js";

export function useCustomFieldDefinitions() {
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listCustomFields().then(({ data, error }) => {
      if (cancelled) return;
      setDefinitions(!error && Array.isArray(data) ? data : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { definitions, loading };
}

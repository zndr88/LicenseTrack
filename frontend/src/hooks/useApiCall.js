import { useState, useCallback } from "react";

export function useApiCall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = useCallback(async (apiFn, options = {}) => {
    const { onSuccess, onError, loadingState = true } = options;
    if (loadingState) setLoading(true);
    setError(null);
    try {
      const { data, error } = await apiFn();
      if (error) {
        setError(error);
        if (onError) onError(error);
        return { data: null, error };
      }
      if (onSuccess) onSuccess(data);
      return { data, error: null };
    } finally {
      if (loadingState) setLoading(false);
    }
  }, []);

  return { loading, error, call };
}

import { useCallback, useState } from "react";

export function useToast() {
  const [toast, setToast] = useState(null);
  // toast shape: { msg, type, action }
  // type: "success" | "error" | "info"
  // action: { label, onClick } | null

  const showToast = useCallback((msg, type = "info", action = null) => {
    setToast({ msg, type, action });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const showSuccess = useCallback((msg, action = null) => showToast(msg, "success", action), [showToast]);
  const showError = useCallback((msg) => showToast(msg, "error"), [showToast]);
  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, showSuccess, showError, dismissToast };
}

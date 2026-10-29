import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  // toast shape: { msg, type, action }
  // type: "success" | "error" | "info"
  // action: { label, onClick } | null

  // One timer at a time: a new toast restarts it, and unmount cancels it.
  const showToast = useCallback((msg, type = "info", action = null) => {
    setToast({ msg, type, action });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const showSuccess = useCallback((msg, action = null) => showToast(msg, "success", action), [showToast]);
  const showError = useCallback((msg) => showToast(msg, "error"), [showToast]);
  const dismissToast = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return { toast, showToast, showSuccess, showError, dismissToast };
}

import { useCallback, useEffect, useRef, useState } from "react";

// Success and info messages clear themselves; errors and warnings stay until
// the user dismisses them or another message replaces them.
export const MESSAGE_AUTO_DISMISS_MS = 5000;
const STAYS_UNTIL_DISMISSED = new Set(["error", "warning"]);

/**
 * The one message state used app-wide, on the Sourcing page and in License
 * Details. Render the returned `toast` with `MessageBanner`.
 */
export function useToast({ defaultType = "info" } = {}) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  // toast shape: { msg, type, action }
  // type: "success" | "warning" | "error" | "info"
  // action: { label, onClick } | null

  // One timer at a time: a new message cancels it, and unmount cancels it.
  const showToast = useCallback((msg, type = defaultType, action = null) => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast({ msg, type, action });
    if (!STAYS_UNTIL_DISMISSED.has(type)) {
      timerRef.current = setTimeout(() => setToast(null), MESSAGE_AUTO_DISMISS_MS);
    }
  }, [defaultType]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const showSuccess = useCallback((msg, action = null) => showToast(msg, "success", action), [showToast]);
  const showError = useCallback((msg) => showToast(msg, "error"), [showToast]);
  const dismissToast = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);

  return { toast, showToast, showSuccess, showError, dismissToast };
}

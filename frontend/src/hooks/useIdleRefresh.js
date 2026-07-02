import { useEffect, useRef } from "react";

const IDLE_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];

/**
 * Calls `callback` when the user has been idle for `idleMs` milliseconds
 * AND the browser tab is currently visible. Resets the idle timer on any
 * user activity. Does nothing when `enabled` is false.
 */
export function useIdleRefresh(callback, { idleMs = 3 * 60 * 1000, enabled = true } = {}) {
  const timerRef = useRef(null);
  const callbackRef = useRef(callback);

  // Keep callbackRef current without re-registering listeners
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (document.visibilityState === "visible") {
          callbackRef.current();
        }
      }, idleMs);
    };

    // Start the timer immediately
    reset();

    // Reset on any activity
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    // Also reset when the tab becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === "visible") reset();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [idleMs, enabled]);
}

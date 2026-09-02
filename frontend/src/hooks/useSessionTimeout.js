import { useEffect, useRef, useCallback } from "react";

export function useSessionTimeout(timeoutMinutes, onTimeout, onActivity) {
  const timerRef = useRef(null);

  const scheduleTimeout = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (timeoutMinutes > 0) {
      timerRef.current = setTimeout(onTimeout, timeoutMinutes * 60 * 1000);
    }
  }, [timeoutMinutes, onTimeout]);

  const handleActivity = useCallback(() => {
    onActivity?.();
    scheduleTimeout();
  }, [onActivity, scheduleTimeout]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, handleActivity));
    scheduleTimeout();
    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMinutes, handleActivity, scheduleTimeout]);
}

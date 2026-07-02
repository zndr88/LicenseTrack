import { useEffect, useRef, useCallback } from "react";

export function useSessionTimeout(timeoutMinutes, onTimeout) {
  const timerRef = useRef(null);
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (timeoutMinutes > 0) {
      timerRef.current = setTimeout(onTimeout, timeoutMinutes * 60 * 1000);
    }
  }, [timeoutMinutes, onTimeout]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMinutes, resetTimer]);
}

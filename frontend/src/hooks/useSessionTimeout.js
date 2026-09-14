import { useEffect } from "react";

const ACTIVITY_KEY = "licensetrack.session.activity";

export function useSessionTimeout(timeoutMinutes, onTimeout, onActivity) {
  useEffect(() => {
    if (timeoutMinutes <= 0) return;
    const timeoutMs = timeoutMinutes * 60_000;
    let lastActivity = Date.now();
    let ended = false;
    let observedActivity = false;
    const readActivity = () => Math.max(lastActivity, Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0);
    const check = () => {
      if (ended) return;
      if (Date.now() - readActivity() >= timeoutMs) {
        ended = true;
        onTimeout();
      } else if (observedActivity || readActivity() > lastActivity) {
        onActivity?.();
      }
    };
    const handleActivity = () => {
      if (Date.now() - readActivity() >= timeoutMs) { check(); return; }
      observedActivity = true;
      lastActivity = Date.now();
      window.localStorage.setItem(ACTIVITY_KEY, String(lastActivity));
      check();
    };
    window.localStorage.setItem(ACTIVITY_KEY, String(lastActivity));
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(event => window.addEventListener(event, handleActivity, { capture: true, passive: true }));
    const timer = setInterval(check, Math.min(1000, timeoutMs));
    check();
    return () => {
      clearInterval(timer);
      events.forEach(event => window.removeEventListener(event, handleActivity, true));
    };
  }, [timeoutMinutes, onTimeout, onActivity]);
}

import { useEffect } from "react";

export function useSessionTimeout(timeoutMinutes, onTimeout, onActivity, coordinationId) {
  useEffect(() => {
    if (timeoutMinutes <= 0) return;
    const timeoutMs = timeoutMinutes * 60_000;
    let lastActivity = Date.now();
    let ended = false;
    let observedActivity = false;
    const activityKey = coordinationId ? `licensetrack.session.${coordinationId}.activity` : "licensetrack.session.activity";
    const readActivity = () => Math.max(lastActivity, Number(window.localStorage.getItem(activityKey)) || 0);
    const check = () => {
      if (ended) return;
      const activity = readActivity();
      if (Date.now() - activity >= timeoutMs) {
        ended = true;
        onTimeout();
      } else if (observedActivity || activity > lastActivity) {
        observedActivity = false;
        lastActivity = activity;
        onActivity?.();
      }
    };
    const handleActivity = () => {
      if (Date.now() - readActivity() >= timeoutMs) { check(); return; }
      observedActivity = true;
      lastActivity = Date.now();
      window.localStorage.setItem(activityKey, String(lastActivity));
      check();
    };
    window.localStorage.setItem(activityKey, String(lastActivity));
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(event => window.addEventListener(event, handleActivity, { capture: true, passive: true }));
    const timer = setInterval(check, Math.min(1000, timeoutMs));
    check();
    return () => {
      clearInterval(timer);
      events.forEach(event => window.removeEventListener(event, handleActivity, true));
    };
  }, [timeoutMinutes, onTimeout, onActivity, coordinationId]);
}

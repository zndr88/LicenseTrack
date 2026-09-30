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
      // While activity stays fresh, report it on every tick rather than once
      // per interaction. onActivity is cheap and self-guarded, and this steady
      // signal is what drives the near-expiry token refresh for a tab that was
      // active earlier and is now present but idle. Collapsing it to a single
      // call lets a low-traffic tab reach expiry without refreshing.
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
      window.localStorage.setItem(activityKey, String(lastActivity));
      check();
    };
    // Reading or scrolling a PDF happens inside its frame, whose events never
    // reach this page. A focused, visible preview counts as activity.
    const PREVIEW_PING_MS = 30 * 1000;
    let lastPreviewPing = 0;
    const readingPreview = () =>
      document.visibilityState === "visible"
      && document.hasFocus()
      && document.activeElement?.tagName === "IFRAME"
      && document.activeElement.closest("[data-document-preview]") !== null;
    const checkPreview = () => {
      if (readingPreview() && Date.now() - lastPreviewPing >= PREVIEW_PING_MS) {
        lastPreviewPing = Date.now();
        handleActivity();
      }
    };
    window.localStorage.setItem(activityKey, String(lastActivity));
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(event => window.addEventListener(event, handleActivity, { capture: true, passive: true }));
    const timer = setInterval(() => { checkPreview(); check(); }, Math.min(1000, timeoutMs));
    check();
    return () => {
      clearInterval(timer);
      events.forEach(event => window.removeEventListener(event, handleActivity, true));
    };
  }, [timeoutMinutes, onTimeout, onActivity, coordinationId]);
}

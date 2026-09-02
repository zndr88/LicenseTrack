const STORAGE_KEY = "licensetrack.licenses.dismissedAttentionIds";

export function loadDismissedAttentionIds() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedAttentionIds(ids) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Session storage can be unavailable under restrictive browser policies.
  }
}

export function clearDismissedAttentionIds() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}

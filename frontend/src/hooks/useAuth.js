import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, logoutSession, refreshSession } from "../api/auth.js";
import { clearDismissedAttentionIds } from "../utils/licenseAttentionSession.js";
import { useSessionTimeout } from "./useSessionTimeout.js";

export function toCurrentUser(apiUser) {
  return {
    id: apiUser.id,
    username: apiUser.username,
    name: apiUser.username,
    role: apiUser.role,
    allowDownloads: apiUser.allow_downloads ?? true,
    avatar: apiUser.username.slice(0, 2).toUpperCase(),
    mustChangePassword: apiUser.must_change_password,
    authProvider: apiUser.auth_provider ?? "local",
    isBreakGlassAdmin: !!apiUser.is_break_glass_admin,
  };
}

export function useAuth({ sessionTimeout, showToast }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const lastRefreshAttemptRef = useRef(Date.now());
  const refreshInFlightRef = useRef(false);

  const handleSessionTimeout = useCallback(async () => {
    await logoutSession();
    clearDismissedAttentionIds();
    setCurrentUser(null);
    showToast("Session expired due to inactivity.", "info");
  }, [showToast]);

  const handleSessionActivity = useCallback(async () => {
    const refreshIntervalMs = sessionTimeout * 60 * 1000 / 2;
    const now = Date.now();
    if (
      refreshIntervalMs <= 0
      || refreshInFlightRef.current
      || now - lastRefreshAttemptRef.current < refreshIntervalMs
    ) return;

    lastRefreshAttemptRef.current = now;
    refreshInFlightRef.current = true;
    const { error } = await refreshSession();
    refreshInFlightRef.current = false;

    if (error) {
      const retryDelayMs = Math.min(60_000, refreshIntervalMs);
      lastRefreshAttemptRef.current = Date.now() - refreshIntervalMs + retryDelayMs;
    }
  }, [sessionTimeout]);

  useSessionTimeout(
    currentUser ? sessionTimeout : 0,
    handleSessionTimeout,
    handleSessionActivity,
  );

  useEffect(() => {
    if (currentUser) return;
    getSession().then(({ data }) => {
      if (data?.authenticated && data.user) {
        lastRefreshAttemptRef.current = Date.now();
        setCurrentUser(toCurrentUser(data.user));
      } else {
        clearDismissedAttentionIds();
      }
      setAuthBootstrapping(false);
    });
  }, [currentUser]);

  const handleLogout = useCallback(async () => {
    await logoutSession();
    clearDismissedAttentionIds();
    setCurrentUser(null);
  }, []);

  return {
    currentUser,
    setCurrentUser,
    authBootstrapping,
    handleLogout,
  };
}

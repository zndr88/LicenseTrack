import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSession, logoutSession, refreshSession } from "../api/auth.js";
import { clearDismissedAttentionIds } from "../utils/licenseAttentionSession.js";
import { getSessionExpiry, lockSession, setSessionRefreshCheck } from "../api/client.js";
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
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState(null);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const bootstrapTimeoutRef = useRef(sessionTimeout);
  const lastRefreshAttemptRef = useRef(Date.now());
  const nextRefreshRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const handleSessionTimeout = useCallback(async () => {
    void logoutSession();
    lockSession();
    setCurrentUser(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    clearDismissedAttentionIds();
    showToast("Session expired due to inactivity.", "info");
  }, [queryClient, showToast]);

  const handleSessionActivity = useCallback(async () => {
    const refreshIntervalMs = sessionTimeout * 60 * 1000 / 2;
    const now = Date.now();
    const expiry = getSessionExpiry();
    if (
      refreshIntervalMs <= 0
      || refreshInFlightRef.current
      || now < nextRefreshRef.current
      || (expiry ? now < expiry - Math.min(60_000, refreshIntervalMs) : now - lastRefreshAttemptRef.current < refreshIntervalMs)
    ) return;

    lastRefreshAttemptRef.current = now;
    refreshInFlightRef.current = true;
    const { error } = await refreshSession();
    refreshInFlightRef.current = false;

    if (error) {
      const retryDelayMs = Math.min(60_000, refreshIntervalMs);
      nextRefreshRef.current = Date.now() + Math.min(retryDelayMs, 5000);
    }
  }, [sessionTimeout]);

  useEffect(() => {
    if (!currentUser) return;
    setSessionRefreshCheck(() => {
      const activity = Number(window.localStorage.getItem("licensetrack.session.activity"));
      if (activity && Date.now() - activity < sessionTimeout * 60_000) return handleSessionActivity();
    });
    return () => setSessionRefreshCheck(null);
  }, [currentUser, sessionTimeout, handleSessionActivity]);

  useSessionTimeout(
    currentUser ? sessionTimeout : 0,
    handleSessionTimeout,
    handleSessionActivity,
  );

  useEffect(() => {
    let cancelled = false;
    getSession().then(({ data }) => {
      if (cancelled) return;
      if (data?.authenticated && data.user) {
        if (data.expires_at) window.localStorage.setItem("licensetrack.session.expiry", String(data.expires_at * 1000));
        lastRefreshAttemptRef.current = data.expires_at
          ? data.expires_at * 1000 - bootstrapTimeoutRef.current * 60_000
          : Date.now();
        setCurrentUser(toCurrentUser(data.user));
      } else {
        clearDismissedAttentionIds();
      }
      setAuthBootstrapping(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === "licensetrack.session.logout") {
        lockSession();
        setCurrentUser(null);
        void queryClient.cancelQueries().then(() => queryClient.clear());
        clearDismissedAttentionIds();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [queryClient]);

  const handleLogout = useCallback(async () => {
    void logoutSession();
    lockSession();
    setCurrentUser(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    clearDismissedAttentionIds();
  }, [queryClient]);

  return {
    currentUser,
    setCurrentUser,
    authBootstrapping,
    handleLogout,
  };
}

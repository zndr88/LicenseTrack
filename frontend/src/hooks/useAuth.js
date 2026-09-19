import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSession, logoutSession, refreshSession } from "../api/auth.js";
import { clearDismissedAttentionIds } from "../utils/licenseAttentionSession.js";
import { getSessionExpiry, lockSession, sessionCoordinationKey, setSessionCoordinationId, setSessionRefreshCheck, unlockSession } from "../api/client.js";
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
  const [coordinationId, setCoordinationId] = useState(null);
  const [authoritativeTimeout, setAuthoritativeTimeout] = useState(null);
  const effectiveSessionTimeout = authoritativeTimeout ?? sessionTimeout;
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
    const refreshIntervalMs = effectiveSessionTimeout * 60 * 1000 / 2;
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
  }, [effectiveSessionTimeout]);

  useEffect(() => {
    if (!currentUser) return;
    setSessionRefreshCheck(() => {
      const activity = Number(window.localStorage.getItem(sessionCoordinationKey("activity")));
      if (activity && Date.now() - activity < effectiveSessionTimeout * 60_000) return handleSessionActivity();
    });
    return () => setSessionRefreshCheck(null);
  }, [currentUser, effectiveSessionTimeout, handleSessionActivity]);

  useSessionTimeout(
    currentUser ? effectiveSessionTimeout : 0,
    handleSessionTimeout,
    handleSessionActivity, coordinationId,
  );

  useEffect(() => {
    let cancelled = false;
    getSession().then(({ data }) => {
      if (cancelled) return;
      if (data?.authenticated && data.user) {
        setSessionCoordinationId(data.coordination_id);
        setCoordinationId(data.coordination_id ?? null);
        setAuthoritativeTimeout(data.session_timeout ?? null);
        if (data.expires_at) window.localStorage.setItem(sessionCoordinationKey("expiry"), String(data.expires_at * 1000));
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
      if (event.key === sessionCoordinationKey("logout")) {
        lockSession();
        setCurrentUser(null);
        void queryClient.cancelQueries().then(() => queryClient.clear());
        clearDismissedAttentionIds();
      }
      if (event.key === "licensetrack.session.authenticated") {
        getSession({ allowLocked: true }).then(({ data }) => {
          if (!data?.authenticated || !data.user) return;
          setSessionCoordinationId(data.coordination_id);
          setCoordinationId(data.coordination_id ?? null);
          unlockSession();
          setCurrentUser(toCurrentUser(data.user));
        });
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
    authoritativeTimeout,
    handleLogout,
  };
}

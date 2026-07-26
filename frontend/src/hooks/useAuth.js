import { useCallback, useEffect, useState } from "react";
import { getSession, logout as apiLogout, logoutSession } from "../api/auth.js";
import { useSessionTimeout } from "./useSessionTimeout.js";

function toCurrentUser(apiUser) {
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

  const handleSessionTimeout = useCallback(async () => {
    await logoutSession();
    apiLogout();
    setCurrentUser(null);
    showToast("Session expired due to inactivity.", "info");
  }, [showToast]);

  useSessionTimeout(currentUser ? sessionTimeout : 0, handleSessionTimeout);

  useEffect(() => {
    if (currentUser) return;
    getSession().then(({ data }) => {
      if (data?.authenticated && data.user) {
        setCurrentUser(toCurrentUser(data.user));
      }
      setAuthBootstrapping(false);
    });
  }, [currentUser]);

  const handleLogout = useCallback(async () => {
    await logoutSession();
    apiLogout();
    setCurrentUser(null);
  }, []);

  return {
    currentUser,
    setCurrentUser,
    authBootstrapping,
    handleLogout,
  };
}

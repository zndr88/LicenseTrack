import React, { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../api/client.js";
import { getAuthMode, login as apiLogin } from "../../api/auth.js";
import Icon from "../ui/Icon.jsx";

const ERROR_MESSAGES = {
  local_account: "This account uses local login. Sign in with your username and password.",
  not_provisioned: "No account was found for this SSO identity. Contact your administrator.",
  oidc_failed: "SSO sign-in failed. Try again or use the local admin login.",
  oidc_unavailable: "SSO is currently unavailable. Local login remains available.",
};

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

const LoginScreen = ({ onLogin }) => {
  const [username, setUsername] = useState(DEMO_MODE ? "demo" : "");
  const [password, setPassword] = useState(DEMO_MODE ? "demo" : "");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState(null);
  const [showLocalLogin, setShowLocalLogin] = useState(false);

  useEffect(() => {
    getAuthMode().then((mode) => setAuthMode(mode));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextError = params.get("error");
    setError(nextError ? (ERROR_MESSAGES[nextError] ?? "Authentication failed.") : null);
    if (nextError === "local_account" || nextError === "oidc_failed" || nextError === "oidc_unavailable") {
      setShowLocalLogin(true);
    }
  }, []);

  useEffect(() => {
    if (authMode && (!authMode.oidc_enabled || !authMode.oidc_available)) {
      setShowLocalLogin(true);
    }
  }, [authMode]);

  const oidcInfo = useMemo(() => {
    if (authMode?.oidc_enabled && !authMode.oidc_available) {
      return "SSO is configured but currently unavailable. Local login is still available.";
    }
    return null;
  }, [authMode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Username and password are required.");
      return;
    }
    setError(null);
    setLoading(true);
    const { data, error: loginError } = await apiLogin(username, password);
    setLoading(false);
    if (loginError) {
      setError(loginError);
      return;
    }
    onLogin({
      id: data.user.id,
      username: data.user.username,
      name: data.user.username,
      role: data.user.role,
      allowDownloads: data.user.allow_downloads ?? true,
      avatar: data.user.username.slice(0, 2).toUpperCase(),
      mustChangePassword: data.user.must_change_password,
      authProvider: data.user.auth_provider ?? "local",
      isBreakGlassAdmin: !!data.user.is_break_glass_admin,
    });
  };

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        <div className="login-brand">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="file" size={44} color="var(--brand-color)" />
            <div style={{ fontFamily: "var(--font-brand)", fontWeight: 700, fontSize: 16, letterSpacing: "0.1em", color: "var(--brand-color)", lineHeight: 1 }}>
              Software License Lifecycle Management
            </div>
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div style={{ padding: "8px 12px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", fontSize: 12, color: "var(--red-text)", marginBottom: 8 }}>
              {error}
            </div>
          )}
          {oidcInfo && (
            <div style={{ padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
              {oidcInfo}
            </div>
          )}
          {authMode?.oidc_enabled && authMode.oidc_available && (
            <>
              <button
                className="btn btn-p btn-full"
                type="button"
                style={{ marginTop: 4 }}
                onClick={() => { window.location.href = apiUrl("/api/auth/oidc/login"); }}
              >
                <Icon name="lock" size={14} /> Sign in with SSO
              </button>
              {!showLocalLogin && (
                <button
                  type="button"
                  onClick={() => setShowLocalLogin(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-2)",
                    fontSize: 12,
                    textDecoration: "underline",
                    cursor: "pointer",
                    marginTop: 10,
                    padding: 0,
                  }}
                >
                  Use local admin login
                </button>
              )}
            </>
          )}
          {showLocalLogin && (
            <>
              {authMode?.oidc_enabled && authMode.oidc_available && (
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 12, marginBottom: 4 }}>
                  Local login is reserved for break-glass and admin access.
                </div>
              )}
              {DEMO_MODE && (
                <>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 10, marginBottom: 6 }}>
                    Demo credentials are prefilled. Any non-empty values work.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <a className="btn btn-g" href="../" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}>
                      Back to homepage
                    </a>
                    <a className="btn btn-g" href="../docs/" style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}>
                      To documentation
                    </a>
                  </div>
                </>
              )}
              <div className="fg">
                <label htmlFor="login-username">Username</label>
                <input id="login-username" className="fi" type="text" value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} disabled={loading} />
              </div>
              <div className="fg">
                <label htmlFor="login-password">Password</label>
                <input id="login-password" className="fi" type="password" value={password} placeholder="••••••••••••" autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} disabled={loading} />
              </div>
              <button className="btn btn-g btn-full" type="submit" disabled={loading} style={{ marginTop: 4 }}>
                {loading ? "Signing in..." : "Sign in locally"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;

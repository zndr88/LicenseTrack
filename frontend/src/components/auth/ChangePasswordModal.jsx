import React, { useState } from "react";
import { changePassword } from "../../api/auth.js";
import Icon from "../ui/Icon.jsx";

const ChangePasswordModal = ({ onSuccess }) => {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentPwd || !newPwd || !confirmPwd) { setError("All fields are required."); return; }
    if (newPwd !== confirmPwd) { setError("New passwords do not match."); return; }
    if (newPwd.length < 12) { setError("New password must be at least 12 characters."); return; }
    setError(null);
    setSaving(true);
    const { error: apiError } = await changePassword(currentPwd, newPwd);
    setSaving(false);
    if (apiError) { setError(apiError); return; }
    onSuccess();
  };

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        <div className="login-brand">
          <div className="icon-wrap"><Icon name="lock" size={22} color="white" /></div>
          <h1>Change Password</h1>
          <p>You must set a new password before continuing.</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="fg">
            <label htmlFor="change-password-current">Current Password</label>
            <input id="change-password-current" className="fi" type="password" value={currentPwd} autoComplete="current-password"
              placeholder="••••••••" onChange={(e) => setCurrentPwd(e.target.value)} disabled={saving} />
          </div>
          <div className="fg">
            <label htmlFor="change-password-new">New Password</label>
            <input id="change-password-new" className="fi" type="password" value={newPwd} autoComplete="new-password"
              placeholder="••••••••" onChange={(e) => setNewPwd(e.target.value)} disabled={saving} />
          </div>
          <div className="fg">
            <label htmlFor="change-password-confirm">Confirm New Password</label>
            <input id="change-password-confirm" className="fi" type="password" value={confirmPwd} autoComplete="new-password"
              placeholder="••••••••" onChange={(e) => setConfirmPwd(e.target.value)} disabled={saving} />
          </div>
          {error && (
            <div style={{ padding: "8px 12px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", fontSize: 12, color: "var(--red-text)", marginBottom: 8 }}>
              {error}
            </div>
          )}
          <button className="btn btn-p btn-full" type="submit" disabled={saving} style={{ marginTop: 4 }}>
            {saving ? "Saving..." : "Set New Password"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordModal;

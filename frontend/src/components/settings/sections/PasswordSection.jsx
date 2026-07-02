import { useState } from "react";
import { changePassword } from "../../../api/auth.js";
import Icon from "../../ui/Icon.jsx";
import { SectionHeader } from "../SectionShared.jsx";

export default function PasswordSection({ isOpen, isDirty, onToggle, globalSettings, onToast }) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdError, setPwdError] = useState(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) { setPwdError("All fields are required."); return; }
    if (newPwd !== confirmPwd) { setPwdError("New passwords do not match."); return; }
    const minLen = globalSettings.passwordMinLength ?? 12;
    if (newPwd.length < minLen) { setPwdError(`New password must be at least ${minLen} characters.`); return; }
    setPwdError(null);
    setPwdSaving(true);
    const { error } = await changePassword(currentPwd, newPwd);
    setPwdSaving(false);
    if (error) { setPwdError(error); return; }
    setShowPasswordForm(false);
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    onToast("Password updated successfully.", "success");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="password" icon="lock" title="Password" description="Change your account password" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            {!showPasswordForm ? (
              <button className="btn btn-g" onClick={() => setShowPasswordForm(true)}>
                <Icon name="edit" size={14} /> Change Password
              </button>
            ) : (
              <div>
                <div className="fr">
                  <div className="fg">
                    <label htmlFor="settings-current-pwd">Current Password</label>
                    <input id="settings-current-pwd" className="fi" type="password" autoComplete="current-password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} placeholder="••••••••" />
                  </div>
                </div>
                <div className="fr">
                  <div className="fg">
                    <label htmlFor="settings-new-pwd">New Password</label>
                    <input id="settings-new-pwd" className="fi" type="password" autoComplete="new-password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="••••••••" />
                  </div>
                </div>
                <div className="fr">
                  <div className="fg">
                    <label htmlFor="settings-confirm-pwd">Confirm New Password</label>
                    <input id="settings-confirm-pwd" className="fi" type="password" autoComplete="new-password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="••••••••" />
                  </div>
                </div>
                {pwdError && (
                  <div style={{ padding: "8px 12px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", fontSize: 12, color: "var(--red-text)", marginBottom: 8 }}>
                    {pwdError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-p" disabled={pwdSaving} onClick={handleChangePassword}>
                    {pwdSaving ? "Saving…" : "Update Password"}
                  </button>
                  <button className="btn btn-g" onClick={() => { setShowPasswordForm(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); setPwdError(null); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

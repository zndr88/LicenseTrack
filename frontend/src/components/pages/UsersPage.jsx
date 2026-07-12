import React, { useEffect, useMemo, useState } from "react";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import {
  createUser,
  deleteUser,
  getDepartments,
  getUserDepartments,
  getUsers,
  resetUserPassword,
  updateUser,
  updateUserDepartments,
} from "../../api/users.js";
import DepartmentMultiSelect from "../users/DepartmentMultiSelect.jsx";
import NewUserForm from "../users/NewUserForm.jsx";
import ResetPasswordPanel from "../users/ResetPasswordPanel.jsx";

const DEFAULT_NEW_USER = {
  username: "",
  email: "",
  password: "",
  role: "viewer",
  allow_downloads: true,
  auth_provider: "local",
  departments: [],
};

function buildEditableUser(user) {
  return {
    username: user.username,
    email: user.email,
    role: user.role,
    allow_downloads: user.allow_downloads ?? true,
    is_active: user.is_active,
    auth_provider: user.auth_provider ?? "local",
    password: "",
  };
}

export default function UsersPage({ currentUserId, onError, onToast: _onToast }) {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [newUser, setNewUser] = useState(DEFAULT_NEW_USER);
  const [addError, setAddError] = useState(null);
  const [editState, setEditState] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [resetUserId, setResetUserId] = useState(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetError, setResetError] = useState(null);
  const [resetSaving, setResetSaving] = useState(false);
  const [availableDepts, setAvailableDepts] = useState([]);
  const [deptAssignments, setDeptAssignments] = useState({});
  const [deptSaving, setDeptSaving] = useState(null);

  useEffect(() => {
    getUsers().then(async ({ data, error }) => {
      if (error) {
        onError?.(error);
      }
      if (data) {
        setUsers(data);
        setEditState(Object.fromEntries(data.map((user) => [user.id, buildEditableUser(user)])));

        const [deptsResult] = await Promise.all([getDepartments()]);
        setAvailableDepts(deptsResult.data ?? []);

        const viewerUsers = data.filter((u) => u.role === "viewer");
        const deptResults = await Promise.all(
          viewerUsers.map((u) => getUserDepartments(u.id))
        );
        const assignments = {};
        viewerUsers.forEach((u, i) => {
          assignments[u.id] = deptResults[i].data ?? [];
        });
        setDeptAssignments(assignments);
      }
      setUsersLoading(false);
    });
  }, [onError]);

  const deletingUser = useMemo(
    () => users.find((user) => user.id === confirmDeleteId) ?? null,
    [users, confirmDeleteId]
  );

  const handleInlineChange = (userId, field, value) => {
    setEditState((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        [field]: value,
        ...(field === "auth_provider" && value === "oidc" ? { password: "" } : {}),
      },
    }));
  };

  const handleSaveUser = async (user) => {
    const draft = editState[user.id];
    setSavingUserId(user.id);
    const payload = {
      username: draft.username,
      email: draft.email,
      role: draft.role,
      allow_downloads: draft.role === "viewer" ? draft.allow_downloads : true,
      is_active: draft.is_active,
      auth_provider: draft.auth_provider,
      ...(draft.password ? { password: draft.password } : {}),
    };
    const { data, error } = await updateUser(user.id, payload);
    if (error) {
      setSavingUserId(null);
      onError(error);
      return;
    }

    const depts = draft.role === "viewer"
      ? (deptAssignments[user.id] ?? [])
      : [];
    setDeptSaving(user.id);
    const { error: deptError } = await updateUserDepartments(user.id, depts);
    setDeptSaving(null);
    if (deptError) {
      setSavingUserId(null);
      onError(deptError);
      return;
    }
    setDeptAssignments((prev) => ({ ...prev, [user.id]: depts }));

    setSavingUserId(null);
    setAddError(null);
    setUsers((prev) => prev.map((entry) => (entry.id === user.id ? data : entry)));
    setEditState((prev) => ({ ...prev, [user.id]: buildEditableUser(data) }));
  };

  const handleAddUser = async () => {
    const needsPassword = newUser.auth_provider === "local";
    if (!newUser.username || !newUser.email || (needsPassword && !newUser.password)) {
      setAddError(needsPassword
        ? "Username, email, and password are required for local users."
        : "Username and email are required for OIDC users.");
      return;
    }
    const payload = {
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      allow_downloads: newUser.role === "viewer" ? newUser.allow_downloads : true,
      auth_provider: newUser.auth_provider,
      ...(needsPassword ? { password: newUser.password } : {}),
    };
    const { data, error } = await createUser(payload);
    if (error) {
      setAddError(error);
      return;
    }

    if (newUser.role === "viewer" && newUser.departments.length > 0) {
      const { error: deptError } = await updateUserDepartments(data.id, newUser.departments);
      if (deptError) {
        setAddError(deptError);
        return;
      }
    }
    setDeptAssignments((prev) => ({ ...prev, [data.id]: newUser.role === "viewer" ? newUser.departments : [] }));

    setUsers((prev) => [...prev, data]);
    setEditState((prev) => ({ ...prev, [data.id]: buildEditableUser(data) }));
    setNewUser(DEFAULT_NEW_USER);
    setAddError(null);
  };

  const handleDeleteUser = async (userId) => {
    const { error } = await deleteUser(userId);
    if (error) {
      setAddError(error);
      return;
    }
    setUsers((prev) => prev.filter((user) => user.id !== userId));
    setConfirmDeleteId(null);
  };

  const handleResetPassword = async () => {
    if (!resetPwd) {
      setResetError("Password is required.");
      return;
    }
    setResetSaving(true);
    const { error } = await resetUserPassword(resetUserId, resetPwd);
    setResetSaving(false);
    if (error) {
      setResetError(error);
      return;
    }
    setResetPwd("");
    setResetError(null);
    setResetUserId(null);
  };

  return (
    <>
      <div className="page-header">
        <h2>User Management</h2>
        <p>Manage user accounts, roles, and department access</p>
      </div>

      <div className="page-content">
        {addError && (
          <div className="um-error-banner">{addError}</div>
        )}

        <div className="fs" style={{ marginBottom: 16 }}>
          <h4><Icon name="lock" size={14} color="var(--accent)" /> Break-glass protection</h4>
          <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
            The system always keeps at least one active local admin available.
            Protected break-glass admins cannot be converted to OIDC, disabled,
            demoted, or deleted.
          </div>
        </div>

        {usersLoading ? (
          <div className="um-loading">Loading users…</div>
        ) : (
          <div className="um-user-grid">
            {users.map((user) => {
              const draft = editState[user.id] ?? buildEditableUser(user);
              const isProtected = !!user.is_break_glass_admin;
              const isSelf = user.id === currentUserId;
              return (
                <div key={user.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12, background: "var(--bg-1)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                        {user.username}
                        {isProtected && <span className="sec-badge">Break-glass</span>}
                        <span className="sec-badge">{user.auth_provider === "oidc" ? "OIDC" : "Local"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{user.email}</div>
                    </div>
                    {!isProtected && !isSelf && (
                      <button
                        type="button"
                        title="Delete user"
                        aria-label="Delete user"
                        onClick={() => setConfirmDeleteId(user.id)}
                        style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>

                  <div className="fr">
                    <div className="fg">
                      <label>Username</label>
                      <input
                        className="fi"
                        value={draft.username}
                        disabled={isProtected}
                        onChange={(e) => handleInlineChange(user.id, "username", e.target.value)}
                      />
                    </div>
                    <div className="fg">
                      <label>Email</label>
                      <input
                        className="fi"
                        value={draft.email}
                        onChange={(e) => handleInlineChange(user.id, "email", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="fr">
                    <div className="fg">
                      <label>Role</label>
                      <select
                        className="fi fi-select"
                        value={draft.role}
                        disabled={isProtected}
                        onChange={(e) => handleInlineChange(user.id, "role", e.target.value)}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="fg">
                      <label>Auth Provider</label>
                      <select
                        className="fi fi-select"
                        value={draft.auth_provider}
                        disabled={isProtected}
                        onChange={(e) => handleInlineChange(user.id, "auth_provider", e.target.value)}
                      >
                        <option value="local">Local</option>
                        <option value="oidc">OIDC</option>
                      </select>
                    </div>
                    <div className="fg">
                      <label>Status</label>
                      <select
                        className="fi fi-select"
                        value={draft.is_active ? "active" : "disabled"}
                        disabled={isProtected}
                        onChange={(e) => handleInlineChange(user.id, "is_active", e.target.value === "active")}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                  </div>

                  {draft.role === "viewer" && (
                    <div className="fr" style={{ marginTop: 6 }}>
                      <div className="fg" style={{ flex: 1 }}>
                        <label htmlFor={`dept-access-${user.id}`}>Department access</label>
                        <DepartmentMultiSelect
                          available={availableDepts}
                          selected={deptAssignments[user.id] ?? []}
                          onChange={(deps) =>
                            setDeptAssignments((prev) => ({ ...prev, [user.id]: deps }))
                          }
                          disabled={deptSaving === user.id}
                        />
                        <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
                          Select which departments this viewer can access. No selection = no access.
                        </div>
                      </div>
                      <div className="fg" style={{ minWidth: 180 }}>
                        <label>Downloads</label>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", minHeight: 32 }}>
                          <input
                            type="checkbox"
                            checked={draft.allow_downloads}
                            onChange={(e) => handleInlineChange(user.id, "allow_downloads", e.target.checked)}
                          />
                          Allow downloads
                        </label>
                      </div>
                    </div>
                  )}

                  {draft.auth_provider === "local" && (
                    <div className="fg">
                      <label>Set New Password (optional)</label>
                      <input
                        className="fi"
                        type="password"
                        value={draft.password}
                        onChange={(e) => handleInlineChange(user.id, "password", e.target.value)}
                        placeholder="Leave blank to keep current password"
                      />
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {isProtected
                        ? "Protected local admin account."
                        : draft.auth_provider === "oidc"
                          ? "OIDC users authenticate through SSO and do not use local passwords."
                          : "Local users can sign in even if OIDC is unavailable."}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {draft.auth_provider === "local" && !isSelf && (
                        <button
                          type="button"
                          className="btn btn-g"
                          style={{ fontSize: 12 }}
                          onClick={() => { setResetUserId(user.id); setResetPwd(""); setResetError(null); }}
                        >
                          <Icon name="key" size={13} /> Reset Password
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-p"
                        style={{ fontSize: 12 }}
                        disabled={savingUserId === user.id}
                        onClick={() => handleSaveUser(user)}
                      >
                        {savingUserId === user.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>

                  {resetUserId === user.id && (
                    <ResetPasswordPanel
                      error={resetError}
                      password={resetPwd}
                      saving={resetSaving}
                      onCancel={() => setResetUserId(null)}
                      onChangePassword={setResetPwd}
                      onReset={handleResetPassword}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <NewUserForm
          availableDepts={availableDepts}
          newUser={newUser}
          setNewUser={setNewUser}
          onAddUser={handleAddUser}
        />
      </div>

      {deletingUser && (
        <ConfirmDialog
          message={`Delete ${deletingUser.username}? This cannot be undone.`}
          onConfirm={() => handleDeleteUser(deletingUser.id)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </>
  );
}

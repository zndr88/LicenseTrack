import Icon from "../ui/Icon.jsx";
import DepartmentMultiSelect from "./DepartmentMultiSelect.jsx";

export default function NewUserForm({ availableDepts, newUser, onAddUser, setNewUser }) {
  return (
    <div className="um-add-section">
      <h4><Icon name="plus" size={13} /> Add New User</h4>
      <div className="fr">
        <div className="fg">
          <label>Username</label>
          <input className="fi" value={newUser.username} onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))} placeholder="username" />
        </div>
        <div className="fg">
          <label>Email</label>
          <input className="fi" value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} placeholder="user@example.com" />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label>Role</label>
          <select className="fi fi-select" value={newUser.role} onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="fg">
          <label>Auth Provider</label>
          <select className="fi fi-select" value={newUser.auth_provider} onChange={(e) => setNewUser((prev) => ({ ...prev, auth_provider: e.target.value, password: e.target.value === "oidc" ? "" : prev.password }))}>
            <option value="local">Local</option>
            <option value="oidc">OIDC</option>
          </select>
        </div>
      </div>
      {newUser.role === "viewer" && (
        <div className="fr" style={{ flex: "100%" }}>
          <div className="fg" style={{ flex: 1 }}>
            <label>Department access</label>
            <DepartmentMultiSelect
              available={availableDepts}
              selected={newUser.departments}
              onChange={(deps) => setNewUser((prev) => ({ ...prev, departments: deps }))}
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
                checked={newUser.allow_downloads}
                onChange={(e) => setNewUser((prev) => ({ ...prev, allow_downloads: e.target.checked }))}
              />
              Allow downloads
            </label>
          </div>
        </div>
      )}
      {newUser.auth_provider === "local" && (
        <div className="fg">
          <label>Password</label>
          <input className="fi" type="password" value={newUser.password} onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))} placeholder="••••••••" />
        </div>
      )}
      <button type="button" className="btn btn-p" style={{ marginTop: 8 }} onClick={onAddUser}>
        <Icon name="plus" size={14} /> Add User
      </button>
    </div>
  );
}

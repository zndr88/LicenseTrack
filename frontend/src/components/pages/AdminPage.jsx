import React, { lazy, Suspense, useState } from "react";
import AuditLogTab from "../settings/AuditLogTab.jsx";
import UsersPage from "./UsersPage.jsx";
import { isAdmin } from "../../utils/helpers.js";

const SettingsPage = lazy(() => import("./SettingsPage.jsx"));

export default function AdminPage({
  userSettings, setUserSettings,
  globalSettings, setGlobalSettings,
  user, onError, onToast,
  onRefreshLicenses, onRefreshNotifications,
  onCompletenessRulesChanged,
  onCustomFieldsChanged,
  navGuard,
  currentUserId,
}) {
  const [adminSection, setAdminSection] = useState("settings");

  return (
    <>
      <div className="page-header">
        <h2>Admin</h2>
        <p>System settings, user management, and audit log</p>
      </div>

      <div className="admin-subnav">
        <button
          type="button"
          className={`admin-subnav-item${adminSection === "settings" ? " active" : ""}`}
          onClick={() => setAdminSection("settings")}
        >Settings</button>
        <button
          type="button"
          className={`admin-subnav-item${adminSection === "users" ? " active" : ""}`}
          onClick={() => setAdminSection("users")}
        >Users</button>
        {isAdmin(user) && (
          <button
            type="button"
            className={`admin-subnav-item${adminSection === "auditlog" ? " active" : ""}`}
            onClick={() => setAdminSection("auditlog")}
          >Audit Log</button>
        )}
      </div>

      {adminSection === "settings" && (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <SettingsPage
            userSettings={userSettings}
            setUserSettings={setUserSettings}
            globalSettings={globalSettings}
            setGlobalSettings={setGlobalSettings}
            user={user}
            onError={onError}
            onToast={onToast}
            onRefreshLicenses={onRefreshLicenses}
            onRefreshNotifications={onRefreshNotifications}
            onCompletenessRulesChanged={onCompletenessRulesChanged}
            onCustomFieldsChanged={onCustomFieldsChanged}
            navGuard={navGuard}
            _adminOnly={true}
            _hideHeader={true}
          />
        </Suspense>
      )}

      {adminSection === "users" && (
        <UsersPage
          currentUserId={currentUserId}
          onError={onError}
          onToast={onToast}
        />
      )}

      {adminSection === "auditlog" && isAdmin(user) && (
        <AuditLogTab />
      )}
    </>
  );
}

import { useState, useEffect, useRef } from "react";
import { isAdmin } from "../../utils/helpers.js";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import AuditLogTab from "../settings/AuditLogTab.jsx";
import { useDirtySections } from "../../hooks/useDirtySections.js";
import { useExclusiveSectionOpen } from "../../hooks/useExclusiveSectionOpen.js";
import { useNavigationGuard } from "../../hooks/useNavigationGuard.js";
import { SettingsTabs } from "../settings/SectionShared.jsx";
import PasswordSection from "../settings/sections/PasswordSection.jsx";
import AppearanceSection from "../settings/sections/AppearanceSection.jsx";
import VisibleCategoriesSection from "../settings/sections/VisibleCategoriesSection.jsx";
import StorageSection from "../settings/sections/StorageSection.jsx";
import NotificationsSection from "../settings/sections/NotificationsSection.jsx";
import SmtpSection from "../settings/sections/SmtpSection.jsx";
import OidcSection from "../settings/sections/OidcSection.jsx";
import CompletenessSection from "../settings/sections/CompletenessSection.jsx";
import CustomFieldsSection from "../settings/sections/CustomFieldsSection.jsx";
import ImportMappingsSection from "../settings/sections/ImportMappingsSection.jsx";
import ApiTokensSection from "../settings/sections/ApiTokensSection.jsx";
import WebhooksSection from "../settings/sections/WebhooksSection.jsx";
import ExtensionsSection from "../settings/sections/ExtensionsSection.jsx";
import PluginsSection from "../settings/sections/PluginsSection.jsx";
import BackupSection from "../settings/sections/BackupSection.jsx";
import RestoreSection from "../settings/sections/RestoreSection.jsx";
import RenewalsSection from "../settings/sections/RenewalsSection.jsx";

const ADMIN_GROUPS = [
  { id: "general", label: "General" },
  { id: "integrations", label: "Integrations" },
  { id: "operations", label: "Operations" },
];

export default function SettingsPage({
  userSettings, setUserSettings,
  globalSettings, setGlobalSettings,
  user, onError, onToast,
  onRefreshLicenses, onRefreshNotifications: _onRefreshNotifications,
  navGuard,
  _adminOnly = false,
  _hideHeader = false,
  _mySettingsOnly = false,
}) {
  const [activeTab, setActiveTab] = useState(_adminOnly ? "admin" : "my");
  const [adminGroup, setAdminGroup] = useState("general");
  const [navConfirmPending, setNavConfirmPending] = useState(null);

  useEffect(() => { if (_adminOnly) setActiveTab("admin"); }, [_adminOnly]);
  useEffect(() => { if (_mySettingsOnly) setActiveTab("my"); }, [_mySettingsOnly]);

  const { dirtySection, setDirtySection, markDirty, clearDirty, anyDirty } = useDirtySections();
  const { open, toggleSection } = useExclusiveSectionOpen({
    password: false, appearance: false, visibleCategories: false,
    storage: false, notifications: false, renewals: false, smtp: false, oidc: false,
    completeness: false, customFields: false, importMappings: false,
    apiTokens: false, webhooks: false, extensions: false, plugins: false, backup: false, restore: false,
  });

  const savedVisibleRef = useRef({
    visibleInList: userSettings.visibleInList,
    visibleInDetail: userSettings.visibleInDetail,
  });

  useNavigationGuard({ anyDirty, navGuard, onBlockedNavigate: setNavConfirmPending });

  const sharedAdmin = { globalSettings, setGlobalSettings, onError, onToast, navGuard };
  const sharedDirty = (key) => ({ isOpen: open[key], isDirty: !!dirtySection[key], onToggle: toggleSection, markDirty, clearDirty });

  return (
    <>
      {!_hideHeader && (
        <div className="page-header"><h2>Settings</h2><p>Configure notifications, fields, database backup, and access</p></div>
      )}
      <div className="page-content">

        {isAdmin(user) && !_adminOnly && !_mySettingsOnly && (
          <SettingsTabs activeTab={activeTab} onChange={setActiveTab} user={user} />
        )}

        {/* ── My Settings ── */}
        {!_adminOnly && (!isAdmin(user) || activeTab === "my" || _mySettingsOnly) && (
          <>
            {user?.authProvider !== "oidc" && (
              <PasswordSection {...sharedDirty("password")} globalSettings={globalSettings} onToast={onToast} />
            )}
            <AppearanceSection {...sharedDirty("appearance")} userSettings={userSettings} setUserSettings={setUserSettings} onError={onError} onToast={onToast} onRefreshLicenses={onRefreshLicenses} navGuard={navGuard} />
            <VisibleCategoriesSection {...sharedDirty("visibleCategories")} userSettings={userSettings} setUserSettings={setUserSettings} onError={onError} onToast={onToast} onAfterSave={(vals) => { savedVisibleRef.current = vals; }} />
          </>
        )}

        {/* ── Admin Settings ── */}
        {isAdmin(user) && activeTab === "admin" && !_mySettingsOnly && (
          <>
            <div className="admin-subnav" aria-label="Admin settings groups">
              {ADMIN_GROUPS.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`admin-subnav-item${adminGroup === group.id ? " active" : ""}`}
                  onClick={() => setAdminGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            {adminGroup === "general" && (
              <>
                <StorageSection {...sharedDirty("storage")} {...sharedAdmin} />
                <NotificationsSection {...sharedDirty("notifications")} {...sharedAdmin} />
                <RenewalsSection {...sharedDirty("renewals")} {...sharedAdmin} />
                <SmtpSection {...sharedDirty("smtp")} {...sharedAdmin} />
                <OidcSection {...sharedDirty("oidc")} {...sharedAdmin} />
                <CompletenessSection {...sharedDirty("completeness")} {...sharedAdmin} onRefreshLicenses={onRefreshLicenses} />
                <CustomFieldsSection {...sharedDirty("customFields")} onError={onError} onToast={onToast} />
                <ImportMappingsSection {...sharedDirty("importMappings")} onError={onError} onToast={onToast} />
              </>
            )}

            {adminGroup === "integrations" && (
              <>
                <ApiTokensSection {...sharedDirty("apiTokens")} onError={onError} onToast={onToast} userSettings={userSettings} />
                <WebhooksSection {...sharedDirty("webhooks")} onError={onError} onToast={onToast} userSettings={userSettings} />
                <ExtensionsSection {...sharedDirty("extensions")} onError={onError} onToast={onToast} userSettings={userSettings} />
                <PluginsSection {...sharedDirty("plugins")} onError={onError} onToast={onToast} />
              </>
            )}

            {adminGroup === "operations" && (
              <>
                <BackupSection {...sharedDirty("backup")} {...sharedAdmin} userSettings={userSettings} />
                <RestoreSection {...sharedDirty("restore")} onError={onError} onToast={onToast} />
              </>
            )}
          </>
        )}

        {/* ── Audit Log ── */}
        {isAdmin(user) && activeTab === "auditlog" && !_mySettingsOnly && (
          <AuditLogTab />
        )}

      </div>

      {/* Nav guard confirm */}
      {navConfirmPending && (
        <ConfirmDialog
          title="Unsaved Changes"
          message="You have unsaved changes. Leave without saving?"
          confirmLabel="Leave"
          cancelLabel="Stay"
          onConfirm={() => {
            const target = navConfirmPending;
            setNavConfirmPending(null);
            setDirtySection({});
            setUserSettings(s => ({
              ...s,
              visibleInList: savedVisibleRef.current.visibleInList,
              visibleInDetail: savedVisibleRef.current.visibleInDetail,
            }));
            navGuard?.discard?.();
            navGuard?.navigate?.(target);
          }}
          onCancel={() => setNavConfirmPending(null)}
        />
      )}
    </>
  );
}

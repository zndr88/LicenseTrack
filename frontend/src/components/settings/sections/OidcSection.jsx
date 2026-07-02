import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { mapResponseToState } from "../../../utils/settingsHelpers.js";
import { oidcEnabledSaveSchema } from "../../../utils/settingsSchemas.js";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function OidcSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (globalSettings.oidcEnabled) {
      const validation = oidcEnabledSaveSchema.safeParse({
        oidcDiscoveryUrl: globalSettings.oidcDiscoveryUrl,
        oidcClientId: globalSettings.oidcClientId,
      });
      if (!validation.success) { onError(validation.error.issues[0].message); return; }
    }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      oidc_enabled: globalSettings.oidcEnabled,
      oidc_discovery_url: globalSettings.oidcDiscoveryUrl,
      oidc_client_id: globalSettings.oidcClientId,
      oidc_client_secret: globalSettings.oidcClientSecret,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => ({ ...s, ...mapResponseToState(data, s) }));
    navGuard?.sectionSaved?.({ global: mapResponseToState(data, globalSettings) });
    clearDirty("oidc");
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="oidc" icon="lock" title="SSO / OIDC" description="Configure enterprise SSO while keeping local admin fallback available" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            <div className="trow">
              <div>
                <span style={{ fontWeight: 600 }}>Enable OIDC SSO</span>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  Local login always remains available for the protected break-glass admin account.
                </div>
              </div>
              <Toggle value={globalSettings.oidcEnabled ?? false} onChange={(v) => { setGlobalSettings(s => ({ ...s, oidcEnabled: v })); markDirty("oidc"); }} />
            </div>
            <div className="fg">
              <label htmlFor="settings-oidc-discovery">Discovery URL</label>
              <input id="settings-oidc-discovery" className="fi" value={globalSettings.oidcDiscoveryUrl ?? ""} onChange={(e) => { setGlobalSettings(s => ({ ...s, oidcDiscoveryUrl: e.target.value })); markDirty("oidc"); }} placeholder="https://idp.example.com/.well-known/openid-configuration" />
            </div>
            <div className="fr">
              <div className="fg" style={{ flex: 1 }}>
                <label htmlFor="settings-oidc-client-id">Client ID</label>
                <input id="settings-oidc-client-id" className="fi" value={globalSettings.oidcClientId ?? ""} onChange={(e) => { setGlobalSettings(s => ({ ...s, oidcClientId: e.target.value })); markDirty("oidc"); }} />
              </div>
              <div className="fg" style={{ flex: 1 }}>
                <label htmlFor="settings-oidc-client-secret">Client Secret</label>
                <input id="settings-oidc-client-secret" className="fi" type="password" autoComplete="off" value={globalSettings.oidcClientSecret ?? ""} onChange={(e) => { setGlobalSettings(s => ({ ...s, oidcClientSecret: e.target.value })); markDirty("oidc"); }} placeholder="••••••••" />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 6 }}>
              Status: {globalSettings.oidcEnabled ? (globalSettings.oidcAvailable ? "Available" : "Unavailable") : "Disabled"}
            </div>
            <SectionSaveButton sectionKey="oidc" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

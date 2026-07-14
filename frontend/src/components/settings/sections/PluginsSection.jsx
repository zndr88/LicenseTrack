import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  disablePlugin,
  enablePlugin,
  getPluginSettings,
  installPlugin,
  listPlugins,
  previewPluginInstall,
  uninstallPlugin,
  updatePluginSettings,
} from "../../../api/plugins.js";
import Icon from "../../ui/Icon.jsx";
import Badge from "../../ui/Badge.jsx";
import ModalShell from "../../ui/ModalShell.jsx";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader } from "../SectionShared.jsx";

function normalizePlugin(plugin) {
  return {
    ...plugin,
    installedVersion: plugin.installedVersion ?? plugin.installed_version,
    publisherName: plugin.publisherName ?? plugin.publisher_name,
    compatibilityStatus: plugin.compatibilityStatus ?? plugin.compatibility_status,
    lastError: plugin.lastError ?? plugin.last_error,
    runtimeStatus: plugin.runtimeStatus ?? plugin.runtime_status,
    settingDefinitions: plugin.settingDefinitions ?? plugin.setting_definitions ?? [],
  };
}

function statusBadgeType(status) {
  if (status === "enabled") return "green";
  if (status === "disabled" || status === "installed") return "gray";
  if (status === "misconfigured" || status === "incompatible") return "orange";
  return "red";
}

function riskBadgeType(risk) {
  if (risk === "high") return "red";
  if (risk === "medium") return "orange";
  return "gray";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PreviewPill({ label, value }) {
  return (
    <div className="plugin-preview-pill">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function PluginInstallModal({ onClose, onInstalled, onError, onToast }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [installing, setInstalling] = useState(false);

  const manifest = preview?.manifest;
  const hasErrors = (preview?.issues ?? []).some((issue) => issue.severity === "error");

  const handleFile = async (selectedFile) => {
    setFile(selectedFile);
    setPreview(null);
    if (!selectedFile) return;
    setPreviewing(true);
    const { data, error } = await previewPluginInstall(selectedFile);
    setPreviewing(false);
    if (error) {
      onError(error);
      return;
    }
    setPreview(data);
  };

  const handleInstall = async () => {
    if (!file || !preview?.installable) return;
    setInstalling(true);
    const { data, error } = await installPlugin(file);
    setInstalling(false);
    if (error) {
      onError(error);
      return;
    }
    onToast(`Plugin "${data.name}" installed disabled.`, "info");
    onInstalled(data);
  };

  return (
    <ModalShell
      title="Install Plugin"
      titleId="plugin-install-title"
      onClose={onClose}
      closeOnOverlayClick={!installing}
      modalStyle={{ width: 820 }}
      footer={(
        <>
          <button type="button" className="btn btn-g" onClick={onClose} disabled={installing}>Cancel</button>
          <button type="button" className="btn btn-p" onClick={handleInstall} disabled={!preview?.installable || installing}>
            <Icon name={installing ? "clock" : "upload"} size={13} />
            {installing ? "Installing..." : "Install disabled"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <div className="plugin-upload-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            style={{ display: "none" }}
            aria-label="Plugin package zip"
          />
          <button type="button" className="btn btn-g" onClick={() => fileInputRef.current?.click()} disabled={previewing || installing}>
            <Icon name="upload" size={13} /> Choose zip
          </button>
          <div className="plugin-file-meta">
            <strong>{file?.name || "No package selected"}</strong>
            <span>{file ? formatBytes(file.size) : "Upload an offline plugin package."}</span>
          </div>
        </div>

        {previewing && (
          <div className="plugin-muted-line"><Icon name="clock" size={13} /> Validating package...</div>
        )}

        {preview && (
          <div className="plugin-preview">
            <div className="plugin-preview-head">
              <div>
                <h4>{manifest?.name || "Invalid package"}</h4>
                <p>{manifest?.description || "Review validation results before installing."}</p>
              </div>
              <Badge type={preview.installable ? "green" : "red"}>
                {preview.installable ? "Installable" : "Blocked"}
              </Badge>
            </div>

            <div className="plugin-preview-grid">
              <PreviewPill label="Key" value={manifest?.key} />
              <PreviewPill label="Version" value={manifest?.version} />
              <PreviewPill label="Publisher" value={manifest?.publisher?.name} />
              <PreviewPill label="Compatibility" value={preview.compatibilityStatus} />
              <PreviewPill label="Checksum" value={preview.checksumSha256?.slice(0, 16)} />
              <PreviewPill label="Size" value={formatBytes(preview.packageSizeBytes)} />
            </div>

            {preview.issues?.length > 0 && (
              <div className={`plugin-issue-box ${hasErrors ? "error" : "warning"}`}>
                {preview.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className="plugin-issue-row">
                    <Icon name={issue.severity === "error" ? "alert" : "info"} size={14} />
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="plugin-preview-columns">
              <div>
                <h5>Permissions</h5>
                {preview.permissions?.length ? (
                  <div className="plugin-chip-list">
                    {preview.permissions.map((permission) => (
                      <span key={permission.permission} className="plugin-chip">
                        <Badge type={riskBadgeType(permission.risk)}>{permission.risk}</Badge>
                        <strong>{permission.permission}</strong>
                        <span>{permission.description}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="plugin-empty-text">No permissions declared.</p>
                )}
              </div>
              <div>
                <h5>Actions</h5>
                {manifest?.actions?.length ? (
                  <div className="plugin-chip-list">
                    {manifest.actions.map((action) => (
                      <span key={action.key} className="plugin-chip">
                        <strong>{action.label}</strong>
                        <span>{action.slot}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="plugin-empty-text">No actions declared.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function normalizeSettingsPayload(data) {
  const values = {};
  const masked = {};
  for (const item of data?.values ?? []) {
    values[item.key] = item.value ?? "";
    masked[item.key] = !!item.masked;
  }
  return {
    pluginKey: data?.pluginKey,
    definitions: data?.definitions ?? [],
    missingRequired: data?.missingRequired ?? [],
    values,
    masked,
  };
}

function PluginSettingField({ definition, value, masked, onChange }) {
  const key = definition.settingKey;
  const type = definition.settingType;
  const label = (
    <>
      {definition.label}
      {definition.required && <span className="req"> *</span>}
    </>
  );

  if (type === "boolean") {
    return (
      <div className="trow plugin-setting-toggle">
        <div>
          <span style={{ fontWeight: 600 }}>{definition.label}</span>
          {definition.helpText && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{definition.helpText}</div>}
        </div>
        <Toggle value={!!value} ariaLabel={definition.label} onChange={(next) => onChange(key, next, false)} />
      </div>
    );
  }

  if (type === "select") {
    return (
      <div className="fg">
        <label htmlFor={`plugin-setting-${key}`}>{label}</label>
        <select id={`plugin-setting-${key}`} className="fi" value={value ?? ""} onChange={(event) => onChange(key, event.target.value, false)}>
          <option value="">Select...</option>
          {(definition.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {definition.helpText && <span className="plugin-setting-help">{definition.helpText}</span>}
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <div className="fg">
        <label htmlFor={`plugin-setting-${key}`}>{label}</label>
        <textarea id={`plugin-setting-${key}`} className="fi" rows={3} value={value ?? ""} onChange={(event) => onChange(key, event.target.value, false)} />
        {definition.helpText && <span className="plugin-setting-help">{definition.helpText}</span>}
      </div>
    );
  }

  return (
    <div className="fg">
      <label htmlFor={`plugin-setting-${key}`}>{label}</label>
      <input
        id={`plugin-setting-${key}`}
        className="fi"
        type={type === "secret" ? "password" : type === "number" ? "number" : type === "url" ? "url" : "text"}
        autoComplete={type === "secret" ? "off" : undefined}
        value={value ?? ""}
        placeholder={masked ? "••••••••" : undefined}
        onChange={(event) => {
          const nextValue = type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value;
          onChange(key, nextValue, false);
        }}
      />
      {definition.helpText && <span className="plugin-setting-help">{definition.helpText}</span>}
    </div>
  );
}

function PluginDetail({
  plugin,
  settingsState,
  settingsLoading,
  settingsSaving,
  settingsDirty,
  lifecycleBusy,
  onSettingChange,
  onSaveSettings,
  onLifecycle,
}) {
  if (!plugin) {
    return (
      <div className="plugin-detail-empty">
        <Icon name="archive" size={18} />
        <span>Select a plugin to inspect its permissions, settings, and actions.</span>
      </div>
    );
  }

  return (
    <div className="plugin-detail">
      <div className="plugin-detail-head">
        <div>
          <h4>{plugin.name}</h4>
          <p>{plugin.description || plugin.key}</p>
        </div>
        <Badge type={statusBadgeType(plugin.status)}>{plugin.status}</Badge>
      </div>
      <div className="plugin-preview-grid compact">
        <PreviewPill label="Version" value={plugin.installedVersion} />
        <PreviewPill label="Publisher" value={plugin.publisherName} />
        <PreviewPill label="Compatibility" value={plugin.compatibilityStatus} />
        <PreviewPill label="Runtime" value={plugin.runtimeStatus?.health ?? "unknown"} />
      </div>
      {plugin.lastError && <div className="plugin-issue-box error">{plugin.lastError}</div>}
      <div className="plugin-detail-actions">
        <button
          type="button"
          className="btn btn-g btn-sm"
          disabled={plugin.status === "enabled" || !!lifecycleBusy || settingsDirty}
          title={settingsDirty ? "Save settings before enabling" : undefined}
          onClick={() => onLifecycle("enable", plugin)}
        >
          <Icon name="check" size={12} /> {lifecycleBusy === "enable" ? "Enabling..." : "Enable"}
        </button>
        <button
          type="button"
          className="btn btn-g btn-sm"
          disabled={plugin.status !== "enabled" || !!lifecycleBusy}
          onClick={() => onLifecycle("disable", plugin)}
        >
          <Icon name="clock" size={12} /> {lifecycleBusy === "disable" ? "Disabling..." : "Disable"}
        </button>
        <button
          type="button"
          className="btn btn-d btn-sm"
          disabled={!!lifecycleBusy}
          onClick={() => onLifecycle("uninstall", plugin)}
        >
          <Icon name="trash" size={12} /> {lifecycleBusy === "uninstall" ? "Uninstalling..." : "Uninstall"}
        </button>
      </div>
      <div className="plugin-detail-sections">
        <section>
          <h5>Permissions</h5>
          {(plugin.permissions ?? []).length ? (
            <ul>
              {plugin.permissions.map((permission) => (
                <li key={permission.permission}>
                  <span>{permission.permission}</span>
                  <Badge type={permission.granted ? "green" : "gray"}>{permission.granted ? "granted" : "pending"}</Badge>
                </li>
              ))}
            </ul>
          ) : <p>No permissions.</p>}
        </section>
        <section>
          <h5>Settings</h5>
          {settingsLoading ? (
            <p>Loading settings...</p>
          ) : settingsState?.definitions?.length ? (
            <div className="plugin-settings-form">
              {settingsState.missingRequired?.length > 0 && (
                <div className="plugin-issue-box warning">
                  <div className="plugin-issue-row">
                    <Icon name="alert" size={14} />
                    <span>Missing required settings: {settingsState.missingRequired.join(", ")}</span>
                  </div>
                </div>
              )}
              {settingsState.definitions.map((definition) => (
                <PluginSettingField
                  key={definition.settingKey}
                  definition={definition}
                  value={settingsState.values[definition.settingKey]}
                  masked={settingsState.masked[definition.settingKey]}
                  onChange={onSettingChange}
                />
              ))}
              <div className="set-save-row">
                <button type="button" className="btn btn-p" onClick={onSaveSettings} disabled={!settingsDirty || settingsSaving} style={{ fontSize: 13 }}>
                  {settingsSaving ? "Saving..." : "Save settings"}
                </button>
              </div>
            </div>
          ) : <p>No settings.</p>}
        </section>
        <section>
          <h5>Actions</h5>
          {(plugin.actions ?? []).length ? (
            <ul>
              {plugin.actions.map((action) => (
                <li key={action.actionKey}>
                  <span>{action.label}</span>
                  <Badge type="gray">{action.slot}</Badge>
                </li>
              ))}
            </ul>
          ) : <p>No actions.</p>}
        </section>
      </div>
    </div>
  );
}

export default function PluginsSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, onError, onToast }) {
  const [plugins, setPlugins] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [settingsState, setSettingsState] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(null);

  const selectedPlugin = useMemo(
    () => plugins.find((plugin) => plugin.key === selectedKey) ?? plugins[0] ?? null,
    [plugins, selectedKey],
  );
  const selectedPluginSettingsKey = selectedPlugin?.key;

  const loadPlugins = useCallback(() => {
    setLoading(true);
    listPlugins().then(({ data, error }) => {
      setLoading(false);
      if (error) {
        onError(error);
        return;
      }
      const normalized = (data ?? []).map(normalizePlugin);
      setPlugins(normalized);
      setSelectedKey((current) => current ?? normalized[0]?.key ?? null);
    });
  }, [onError]);

  useEffect(() => {
    if (!isOpen) return;
    loadPlugins();
  }, [isOpen, loadPlugins]);

  useEffect(() => {
    if (!isOpen || !selectedPluginSettingsKey) {
      setSettingsState(null);
      return;
    }
    setSettingsLoading(true);
    setSettingsDirty(false);
    getPluginSettings(selectedPluginSettingsKey).then(({ data, error }) => {
      setSettingsLoading(false);
      if (error) {
        onError(error);
        return;
      }
      setSettingsState(normalizeSettingsPayload(data));
    });
  }, [isOpen, selectedPluginSettingsKey, onError]);

  const handleInstalled = (plugin) => {
    const normalized = normalizePlugin(plugin);
    setPlugins((current) => [normalized, ...current.filter((item) => item.key !== normalized.key)]);
    setSelectedKey(normalized.key);
    setShowInstall(false);
  };

  const handleSettingChange = (key, value, masked = false) => {
    setSettingsState((current) => ({
      ...current,
      values: { ...(current?.values ?? {}), [key]: value },
      masked: { ...(current?.masked ?? {}), [key]: masked },
    }));
    setSettingsDirty(true);
    markDirty?.("plugins");
  };

  const handleSaveSettings = async () => {
    if (!selectedPlugin || !settingsState) return;
    const values = settingsState.definitions.map((definition) => ({
      key: definition.settingKey,
      value: settingsState.values[definition.settingKey] ?? null,
      masked: !!settingsState.masked[definition.settingKey],
    }));
    setSettingsSaving(true);
    const { data, error } = await updatePluginSettings(selectedPlugin.key, values);
    setSettingsSaving(false);
    if (error) {
      onError(error);
      return;
    }
    setSettingsState(normalizeSettingsPayload(data));
    setSettingsDirty(false);
    clearDirty?.("plugins");
    onToast("Plugin settings saved.", "info");
    loadPlugins();
  };

  const updatePluginInList = (plugin) => {
    const normalized = normalizePlugin(plugin);
    setPlugins((current) => current.map((item) => (item.key === normalized.key ? normalized : item)));
    setSelectedKey(normalized.key);
  };

  const handleLifecycle = async (action, plugin) => {
    if (!plugin) return;
    if (action === "uninstall" && !window.confirm(`Uninstall "${plugin.name}"? Plugin files and active settings will be removed.`)) {
      return;
    }

    setLifecycleBusy(action);
    const request =
      action === "enable" ? enablePlugin(plugin.key) :
      action === "disable" ? disablePlugin(plugin.key) :
      uninstallPlugin(plugin.key);
    const { data, error } = await request;
    setLifecycleBusy(null);
    if (error) {
      onError(error);
      loadPlugins();
      return;
    }
    if (action === "uninstall") {
      setPlugins((current) => {
        const next = current.filter((item) => item.key !== plugin.key);
        setSelectedKey(next[0]?.key ?? null);
        return next;
      });
      setSettingsState(null);
      setSettingsDirty(false);
      clearDirty?.("plugins");
      onToast(`Plugin "${plugin.name}" uninstalled.`, "info");
      return;
    }
    if (!data) {
      onError(`Plugin "${plugin.name}" ${action} failed without returning plugin details.`);
      loadPlugins();
      return;
    }
    updatePluginInList(data);
    onToast(`Plugin "${plugin.name}" ${action === "enable" ? "enabled" : "disabled"}.`, "info");
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="plugins" icon="archive" title="Plugins" description="Install and inspect offline plugin packages." isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div className="plugin-section-toolbar">
              <p>Install offline plugin packages, configure settings, and control plugin runtime state.</p>
              <div>
                <button type="button" className="btn btn-g btn-sm" onClick={loadPlugins} disabled={loading}>
                  <Icon name={loading ? "clock" : "refresh"} size={12} /> Refresh
                </button>
                <button type="button" className="btn btn-p btn-sm" onClick={() => setShowInstall(true)}>
                  <Icon name="upload" size={12} /> Install
                </button>
              </div>
            </div>

            {loading ? (
              <p className="plugin-empty-text">Loading plugins...</p>
            ) : plugins.length === 0 ? (
              <div className="plugin-empty-state">
                <Icon name="archive" size={22} />
                <strong>No plugins installed</strong>
                <span>Upload a validated plugin zip to create a disabled registry record.</span>
                <button type="button" className="btn btn-g btn-sm" onClick={() => setShowInstall(true)}>
                  <Icon name="upload" size={12} /> Choose package
                </button>
              </div>
            ) : (
              <div className="plugin-management-grid">
                <div style={{ overflowX: "auto" }}>
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Plugin</th>
                        <th>Status</th>
                        <th>Version</th>
                        <th>Runtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plugins.map((plugin) => (
                        <tr
                          key={plugin.key}
                          className={selectedPlugin?.key === plugin.key ? "plugin-row-selected" : ""}
                          onClick={() => setSelectedKey(plugin.key)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <strong>{plugin.name}</strong>
                            <div style={{ color: "var(--text-3)", fontSize: 12 }}>{plugin.key}</div>
                          </td>
                          <td><Badge type={statusBadgeType(plugin.status)}>{plugin.status}</Badge></td>
                          <td>{plugin.installedVersion}</td>
                          <td>{plugin.runtimeStatus?.health ?? "unknown"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PluginDetail
                  plugin={selectedPlugin}
                  settingsState={settingsState}
                  settingsLoading={settingsLoading}
                  settingsSaving={settingsSaving}
                  settingsDirty={settingsDirty}
                  lifecycleBusy={lifecycleBusy}
                  onSettingChange={handleSettingChange}
                  onSaveSettings={handleSaveSettings}
                  onLifecycle={handleLifecycle}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {showInstall && (
        <PluginInstallModal
          onClose={() => setShowInstall(false)}
          onInstalled={handleInstalled}
          onError={onError}
          onToast={onToast}
        />
      )}
    </>
  );
}

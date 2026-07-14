import { useCallback, useEffect, useState } from "react";
import { deleteExtensionCapability, listExtensionCapabilities } from "../../../api/settings.js";
import { formatDateTime } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

function normalizeCapability(capability) {
  return {
    ...capability,
    capabilityType: capability.capabilityType ?? capability.capability_type,
    healthUrl: capability.healthUrl ?? capability.health_url,
    lastError: capability.lastError ?? capability.last_error,
    updatedAt: capability.updatedAt ?? capability.updated_at,
    lastSeenAt: capability.lastSeenAt ?? capability.last_seen_at,
  };
}

function statusClass(status) {
  if (status === "available") return "set-ext-status-available";
  if (status === "misconfigured") return "set-ext-status-misconfigured";
  return "set-ext-status-error";
}

export default function ExtensionsSection({ isOpen, isDirty, onToggle, onError, onToast, userSettings }) {
  const [capabilities, setCapabilities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletePending, setDeletePending] = useState(null);

  const loadCapabilities = useCallback(() => {
    setLoading(true);
    listExtensionCapabilities().then(({ data, error }) => {
      setLoading(false);
      if (error) { onError(error); return; }
      setCapabilities((data ?? []).map(normalizeCapability));
    });
  }, [onError]);

  useEffect(() => {
    if (!isOpen) return;
    loadCapabilities();
  }, [isOpen, loadCapabilities]);

  const handleDelete = async () => {
    if (!deletePending) return;
    const { error } = await deleteExtensionCapability(deletePending.key);
    if (error) { onError(error); setDeletePending(null); return; }
    setCapabilities((current) => current.filter((capability) => capability.key !== deletePending.key));
    onToast(`Extension capability "${deletePending.name}" removed.`, "info");
    setDeletePending(null);
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="extensions" icon="server" title="Extensions" description="Registered optional capabilities from integrations and sidecars." isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div className="set-ext-header">
              <p className="set-ext-intro">
                Capabilities are declared by external processors using scoped API tokens.
              </p>
              <button type="button" className="btn btn-g btn-sm" onClick={loadCapabilities} disabled={loading}>
                <Icon name={loading ? "clock" : "refresh"} size={12} /> Refresh
              </button>
            </div>

            {loading ? (
              <p className="set-muted-text set-ext-muted">Loading extension capabilities...</p>
            ) : capabilities.length === 0 ? (
              <p className="set-muted-text set-ext-muted">No extension capabilities registered yet.</p>
            ) : (
              <div className="set-table-scroll">
                <table className="settings-table set-ext-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Capability</th>
                      <th>Status</th>
                      <th>Version</th>
                      <th>Last seen</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capabilities.map((capability) => (
                      <tr key={capability.key}>
                        <td>
                          <strong>{capability.name}</strong>
                          <div className="set-ext-key">{capability.key}</div>
                          {capability.description && (
                            <div className="set-ext-description">{capability.description}</div>
                          )}
                        </td>
                        <td>{capability.capabilityType}</td>
                        <td>
                          <span className={`set-ext-status ${statusClass(capability.status)}`}>{capability.status}</span>
                          {capability.lastError && (
                            <div className="set-ext-error">{capability.lastError}</div>
                          )}
                        </td>
                        <td>{capability.version || "-"}</td>
                        <td>{formatDateTime(capability.lastSeenAt, userSettings) || "Never"}</td>
                        <td>
                          <button type="button" className="btn btn-d btn-sm" onClick={() => setDeletePending(capability)}>
                            <Icon name="trash" size={12} /> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {deletePending && (
        <ConfirmDialog
          title="Remove Extension Capability"
          message={`Remove "${deletePending.name}" from the registry? The integration can register it again later.`}
          confirmLabel="Remove"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeletePending(null)}
        />
      )}
    </>
  );
}

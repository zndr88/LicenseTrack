import { useEffect, useState } from "react";
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

function statusColor(status) {
  if (status === "available") return "var(--green-text)";
  if (status === "misconfigured") return "var(--orange-text)";
  return "var(--red)";
}

export default function ExtensionsSection({ isOpen, isDirty, onToggle, onError, onToast, userSettings }) {
  const [capabilities, setCapabilities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletePending, setDeletePending] = useState(null);

  const loadCapabilities = () => {
    setLoading(true);
    listExtensionCapabilities().then(({ data, error }) => {
      setLoading(false);
      if (error) { onError(error); return; }
      setCapabilities((data ?? []).map(normalizeCapability));
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    loadCapabilities();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh when opened

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>
                Capabilities are declared by external processors using scoped API tokens.
              </p>
              <button type="button" className="btn btn-g btn-sm" onClick={loadCapabilities} disabled={loading}>
                <Icon name={loading ? "clock" : "refresh"} size={12} /> Refresh
              </button>
            </div>

            {loading ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Loading extension capabilities...</p>
            ) : capabilities.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No extension capabilities registered yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="settings-table">
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
                          <div style={{ color: "var(--text-3)", fontSize: 12 }}>{capability.key}</div>
                          {capability.description && (
                            <div style={{ color: "var(--text-2)", fontSize: 12, marginTop: 3 }}>{capability.description}</div>
                          )}
                        </td>
                        <td>{capability.capabilityType}</td>
                        <td>
                          <span style={{ color: statusColor(capability.status), fontWeight: 700 }}>{capability.status}</span>
                          {capability.lastError && (
                            <div style={{ color: "var(--red)", fontSize: 12, marginTop: 3 }}>{capability.lastError}</div>
                          )}
                        </td>
                        <td>{capability.version || "-"}</td>
                        <td>{formatDateTime(capability.lastSeenAt, userSettings) || "Never"}</td>
                        <td>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeletePending(capability)}>
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

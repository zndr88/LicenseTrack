import { useEffect, useState } from "react";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  retryWebhookDelivery,
  testWebhook,
  updateWebhook,
} from "../../../api/settings.js";
import { formatDateTime } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const WEBHOOK_EVENTS = [
  ["*", "All events"],
  ["license.created", "License created"],
  ["license.updated", "License updated"],
  ["license.deleted", "License deleted"],
  ["license.custom_fields_updated", "License custom fields updated"],
  ["license.existing_successor_linked", "Existing renewal successor linked"],
  ["license.existing_successor_unlinked", "Existing renewal successor unlinked"],
  ["sourcing_request.created", "Sourcing request created"],
  ["po.created", "Pending order created"],
  ["document.uploaded", "Document uploaded"],
  ["procurement_document.uploaded", "Procurement document uploaded"],
  ["contract_document.uploaded", "Contract document uploaded"],
  ["contract_document.deleted", "Contract document deleted"],
  ["document_action.requested", "Document action requested"],
];

function normalizeEndpoint(endpoint) {
  return {
    ...endpoint,
    isActive: endpoint.isActive ?? endpoint.is_active,
    createdAt: endpoint.createdAt ?? endpoint.created_at,
    updatedAt: endpoint.updatedAt ?? endpoint.updated_at,
    lastSuccessAt: endpoint.lastSuccessAt ?? endpoint.last_success_at,
    lastFailureAt: endpoint.lastFailureAt ?? endpoint.last_failure_at,
    signingSecret: endpoint.signingSecret ?? endpoint.signing_secret,
  };
}

function normalizeDelivery(delivery) {
  return {
    ...delivery,
    endpointId: delivery.endpointId ?? delivery.endpoint_id,
    eventType: delivery.eventType ?? delivery.event_type,
    nextAttemptAt: delivery.nextAttemptAt ?? delivery.next_attempt_at,
    responseStatus: delivery.responseStatus ?? delivery.response_status,
    responseBody: delivery.responseBody ?? delivery.response_body,
    createdAt: delivery.createdAt ?? delivery.created_at,
    deliveredAt: delivery.deliveredAt ?? delivery.delivered_at,
  };
}

function deliveryStatusClass(status) {
  if (status === "succeeded") return "set-webhook-delivery-status-succeeded";
  if (status === "failed") return "set-webhook-delivery-status-failed";
  return "set-webhook-delivery-status-pending";
}

function deliveryResponseLabel(delivery) {
  if (delivery.responseStatus) return `HTTP ${delivery.responseStatus}`;
  if (delivery.error) return delivery.error;
  return "-";
}

function deliveryResponseDetail(delivery) {
  return delivery.responseBody || delivery.error || "";
}

export default function WebhooksSection({ isOpen, isDirty, onToggle, onError, onToast, userSettings }) {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState(["license.created"]);
  const [createdWebhook, setCreatedWebhook] = useState(null);
  const [deletePending, setDeletePending] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editEvents, setEditEvents] = useState([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listWebhooks().then(({ data, error }) => {
      setLoading(false);
      if (error) { onError(error); return; }
      setWebhooks((data ?? []).map(normalizeEndpoint));
    });
  }, [isOpen, onError]);

  const refreshWebhooks = async () => {
    const { data, error } = await listWebhooks();
    if (error) { onError(error); return null; }
    const normalized = (data ?? []).map(normalizeEndpoint);
    setWebhooks(normalized);
    return normalized;
  };

  const loadDeliveries = async (endpoint) => {
    setSelectedEndpoint(endpoint);
    setDeliveriesLoading(true);
    const { data, error } = await listWebhookDeliveries(endpoint.id);
    setDeliveriesLoading(false);
    if (error) { onError(error); return; }
    setDeliveries((data ?? []).map(normalizeDelivery));
  };

  const toggleEvent = (event) => {
    setEvents((current) => {
      if (event === "*") return current.includes("*") ? ["license.created"] : ["*"];
      const withoutAll = current.filter((item) => item !== "*");
      return withoutAll.includes(event)
        ? withoutAll.filter((item) => item !== event)
        : [...withoutAll, event].sort();
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setSaving(true);
    const { data, error } = await createWebhook({ name: name.trim(), url: url.trim(), events, isActive: true });
    setSaving(false);
    if (error) { onError(error); return; }
    const endpoint = normalizeEndpoint(data);
    setWebhooks((current) => [endpoint, ...current]);
    setCreatedWebhook(endpoint);
    setName("");
    setUrl("");
    setEvents(["license.created"]);
    setShowCreate(false);
    onToast("Webhook endpoint created.", "info");
  };

  const handleToggleActive = async (endpoint) => {
    setBusyId(endpoint.id);
    const { data, error } = await updateWebhook(endpoint.id, { isActive: !endpoint.isActive });
    setBusyId(null);
    if (error) { onError(error); return; }
    const updated = normalizeEndpoint(data);
    setWebhooks((current) => current.map((item) => item.id === endpoint.id ? updated : item));
    if (selectedEndpoint?.id === endpoint.id) setSelectedEndpoint(updated);
    onToast(updated.isActive ? "Webhook enabled." : "Webhook disabled.", "info");
  };

  const startEdit = (endpoint) => {
    setEditId(endpoint.id);
    setEditName(endpoint.name);
    setEditUrl(endpoint.url);
    setEditEvents(endpoint.events ?? ["license.created"]);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditUrl("");
    setEditEvents([]);
  };

  const toggleEditEvent = (event) => {
    setEditEvents((current) => {
      if (event === "*") return current.includes("*") ? ["license.created"] : ["*"];
      const withoutAll = current.filter((item) => item !== "*");
      return withoutAll.includes(event)
        ? withoutAll.filter((item) => item !== event)
        : [...withoutAll, event].sort();
    });
  };

  const handleSaveEdit = async () => {
    if (!editId || !editName.trim() || !editUrl.trim() || editEvents.length === 0) return;
    setBusyId(editId);
    const { data, error } = await updateWebhook(editId, {
      name: editName.trim(),
      url: editUrl.trim(),
      events: editEvents,
    });
    setBusyId(null);
    if (error) { onError(error); return; }
    const updated = normalizeEndpoint(data);
    setWebhooks((current) => current.map((item) => item.id === editId ? updated : item));
    if (selectedEndpoint?.id === editId) setSelectedEndpoint(updated);
    cancelEdit();
    onToast("Webhook updated.", "info");
  };

  const handleDelete = async () => {
    if (!deletePending) return;
    const { error } = await deleteWebhook(deletePending.id);
    if (error) { onError(error); setDeletePending(null); return; }
    setWebhooks((current) => current.filter((item) => item.id !== deletePending.id));
    if (selectedEndpoint?.id === deletePending.id) {
      setSelectedEndpoint(null);
      setDeliveries([]);
    }
    onToast(`Webhook "${deletePending.name}" deleted.`, "info");
    setDeletePending(null);
  };

  const handleTest = async (endpoint) => {
    setBusyId(endpoint.id);
    const { data, error } = await testWebhook(endpoint.id);
    setBusyId(null);
    if (error) { onError(error); return; }
    onToast(`Test delivery ${data.status}.`, data.status === "succeeded" ? "info" : "warning");
    const updatedEndpoints = await refreshWebhooks();
    const updatedEndpoint = updatedEndpoints?.find((item) => item.id === endpoint.id) ?? endpoint;
    if (selectedEndpoint?.id === endpoint.id) setSelectedEndpoint(updatedEndpoint);
    if (selectedEndpoint?.id === endpoint.id) await loadDeliveries(endpoint);
  };

  const handleRetry = async (deliveryId) => {
    setBusyId(deliveryId);
    const { data, error } = await retryWebhookDelivery(deliveryId);
    setBusyId(null);
    if (error) { onError(error); return; }
    const updated = normalizeDelivery(data);
    setDeliveries((current) => current.map((item) => item.id === deliveryId ? updated : item));
    onToast(`Delivery ${updated.status}.`, updated.status === "succeeded" ? "info" : "warning");
    await refreshWebhooks();
  };

  const copySecret = async () => {
    if (!createdWebhook?.signingSecret) return;
    try {
      await navigator.clipboard.writeText(createdWebhook.signingSecret);
      onToast("Signing secret copied.", "info");
    } catch {
      onError("Could not copy signing secret to clipboard.");
    }
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="webhooks" icon="link" title="Webhooks" description="Notify internal systems when audited LicenseTrack events occur." isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            {createdWebhook && (
              <div className="set-webhook-secret-panel">
                <div className="set-webhook-secret-header">
                  <strong className="set-webhook-secret-title">Signing secret for {createdWebhook.name}</strong>
                  <button type="button" className="btn btn-g set-webhook-secret-dismiss" onClick={() => setCreatedWebhook(null)}>
                    <Icon name="x" size={12} /> Dismiss
                  </button>
                </div>
                <p className="set-webhook-secret-note">
                  Copy and save this secret now. It cannot be recovered after you dismiss it.
                </p>
                <div className="set-webhook-secret-copy-row">
                  <input className="fi mono set-webhook-secret-input" readOnly value={createdWebhook.signingSecret} />
                  <button type="button" className="btn btn-p set-webhook-secret-copy-button" onClick={copySecret}>Copy</button>
                </div>
              </div>
            )}

            <div className="set-section-stack">
              {loading ? (
                <p className="set-muted-text">Loading...</p>
              ) : webhooks.length === 0 ? (
                <p className="set-muted-text set-list-empty">No webhook endpoints yet.</p>
              ) : (
                <table className="mapping-matched-table set-list-table set-webhook-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">URL</th>
                      <th scope="col">Events</th>
                      <th scope="col">Last Result</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((endpoint) => (
                      <tr key={endpoint.id} className={endpoint.isActive ? undefined : "set-webhook-row-inactive"}>
                        <td>
                          {editId === endpoint.id ? (
                            <input className="fi set-compact-input" value={editName} onChange={(event) => setEditName(event.target.value)} />
                          ) : (
                            <span className="set-webhook-name">{endpoint.name}</span>
                          )}
                        </td>
                        <td>
                          {editId === endpoint.id ? (
                            <input className="fi mono set-compact-input set-webhook-url-input" value={editUrl} onChange={(event) => setEditUrl(event.target.value)} />
                          ) : (
                            <span className="mono set-webhook-url">{endpoint.url}</span>
                          )}
                        </td>
                        <td>
                          {editId === endpoint.id ? (
                            <div className="set-webhook-edit-events">
                              {WEBHOOK_EVENTS.map(([event, label]) => (
                                <label key={event} className={`set-webhook-event-chip${editEvents.includes(event) ? " selected" : ""}`}>
                                  <input type="checkbox" checked={editEvents.includes(event)} onChange={() => toggleEditEvent(event)} />
                                  {label}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <span className="set-webhook-cell-text">{(endpoint.events ?? []).join(", ")}</span>
                          )}
                        </td>
                        <td><span className="set-webhook-cell-text">{endpoint.lastSuccessAt ? `Success ${formatDateTime(endpoint.lastSuccessAt, userSettings)}` : endpoint.lastFailureAt ? `Failed ${formatDateTime(endpoint.lastFailureAt, userSettings)}` : "Never"}</span></td>
                        <td>
                          <div className="set-webhook-actions">
                            {editId === endpoint.id ? (
                              <>
                                <button type="button" className="btn btn-p set-compact-button" disabled={busyId === endpoint.id || !editName.trim() || !editUrl.trim() || editEvents.length === 0} onClick={handleSaveEdit}>Save</button>
                                <button type="button" className="btn btn-g set-compact-button" onClick={cancelEdit}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="btn btn-g set-compact-button" onClick={() => loadDeliveries(endpoint)}>Deliveries</button>
                                <button type="button" className="btn btn-g set-compact-button" disabled={busyId === endpoint.id} onClick={() => handleTest(endpoint)}>Test</button>
                                <button type="button" className="btn btn-g set-compact-button" onClick={() => startEdit(endpoint)}>Edit</button>
                                <button type="button" className="btn btn-g set-compact-button" disabled={busyId === endpoint.id} onClick={() => handleToggleActive(endpoint)}>{endpoint.isActive ? "Disable" : "Enable"}</button>
                                <button type="button" className="btn btn-g set-compact-button set-danger-action" onClick={() => setDeletePending(endpoint)}>Delete</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showCreate ? (
                <div className="set-webhook-form">
                  <div className="set-webhook-form-row">
                    <div className="fg set-webhook-name-field">
                      <label htmlFor="webhook-name">Name</label>
                      <input id="webhook-name" className="fi" value={name} onChange={(event) => setName(event.target.value)} placeholder="CMDB events" autoFocus />
                    </div>
                    <div className="fg set-webhook-url-field">
                      <label htmlFor="webhook-url">URL</label>
                      <input id="webhook-url" className="fi" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhooks/licensetrack" />
                    </div>
                  </div>
                  <div className="fg">
                    <div className="fg-label">Events</div>
                    <div className="set-webhook-create-events">
                      {WEBHOOK_EVENTS.map(([event, label]) => (
                        <label key={event} className={`set-webhook-create-chip${events.includes(event) ? " selected" : ""}`}>
                          <input type="checkbox" checked={events.includes(event)} onChange={() => toggleEvent(event)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="set-webhook-form-actions">
                    <button type="button" className="btn btn-p set-form-button" disabled={saving || !name.trim() || !url.trim() || events.length === 0} onClick={handleCreate}>
                      {saving ? "Creating..." : "Create"}
                    </button>
                    <button type="button" className="btn btn-g set-form-button" onClick={() => { setShowCreate(false); setName(""); setUrl(""); setEvents(["license.created"]); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-g set-webhook-create-button" onClick={() => setShowCreate(true)}>
                  <Icon name="plus" size={13} /> Create Webhook
                </button>
              )}

              {selectedEndpoint && (
                <div className="set-webhook-deliveries">
                  <div className="set-webhook-deliveries-header">
                    <strong className="set-webhook-deliveries-title">Recent deliveries for {selectedEndpoint.name}</strong>
                    <button type="button" className="btn btn-g set-webhook-deliveries-refresh" onClick={() => loadDeliveries(selectedEndpoint)}>Refresh</button>
                  </div>
                  {deliveriesLoading ? (
                    <p className="set-muted-text set-webhook-deliveries-muted">Loading...</p>
                  ) : deliveries.length === 0 ? (
                    <p className="set-muted-text set-webhook-deliveries-muted">No deliveries yet.</p>
                  ) : (
                    <table className="mapping-matched-table set-webhook-deliveries-table">
                      <thead>
                        <tr>
                          <th scope="col">Event</th>
                          <th scope="col">Status</th>
                          <th scope="col">Attempts</th>
                          <th scope="col">Response</th>
                          <th scope="col">Created</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveries.map((delivery) => (
                          <tr key={delivery.id}>
                            <td><span className="mono set-webhook-delivery-event">{delivery.eventType}</span></td>
                            <td><span className={`set-webhook-delivery-status ${deliveryStatusClass(delivery.status)}`}>{delivery.status}</span></td>
                            <td><span className="set-webhook-cell-text">{delivery.attempts}</span></td>
                            <td>
                              <div className="set-webhook-cell-text">{deliveryResponseLabel(delivery)}</div>
                              {deliveryResponseDetail(delivery) && (
                                <div
                                  title={deliveryResponseDetail(delivery)}
                                  className="set-webhook-delivery-detail"
                                >
                                  {deliveryResponseDetail(delivery)}
                                </div>
                              )}
                              {delivery.nextAttemptAt && delivery.status === "pending" && (
                                <div className="set-webhook-delivery-retry">
                                  Next retry {formatDateTime(delivery.nextAttemptAt, userSettings)}
                                </div>
                              )}
                            </td>
                            <td><span className="set-webhook-cell-text">{formatDateTime(delivery.createdAt, userSettings)}</span></td>
                            <td>
                              <button type="button" className="btn btn-g set-compact-button" disabled={busyId === delivery.id} onClick={() => handleRetry(delivery.id)}>Retry</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {deletePending && (
        <ConfirmDialog title="Delete Webhook" message={`Delete "${deletePending.name}"? Future events will no longer be sent to this endpoint.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeletePending(null)} />
      )}
    </>
  );
}

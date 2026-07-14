import React, { useState, useEffect, useCallback } from "react";
import Icon from "../ui/Icon.jsx";
import Badge from "../ui/Badge.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ContractDocumentsSection from "./ContractDocumentsSection.jsx";
import { isEditorOrAdmin } from "../../utils/helpers.js";
import { useDirtyForm } from "../../hooks/useDirtyForm.js";
import {
  getContract,
  getContractLicenses,
  updateContract,
} from "../../api/contracts.js";

const STATUS_BADGE_TYPE = {
  active:    "green",
  expiring:  "orange",
  expired:   "red",
  perpetual: "blue",
  legacy:    "gray",
  retired:   "gray",
};

const STATUS_LABEL = {
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  perpetual: "Perpetual",
  legacy: "Legacy",
  renewed: "Renewed",
  pending_renewal: "Pending Renewal",
  retired: "Retired",
};

export default function ContractModal({ contractId, onClose, onNavigateToLicense, user }) {
  const [contract, setContract] = useState(null);
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Collapsible sections
  const [licensesOpen, setLicensesOpen] = useState(true);

  // Unsaved-changes guard (edit mode only)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [discardAction, setDiscardAction] = useState(null); // "close" | "cancel-edit"
  const { isDirty, setInitial, check, reset } = useDirtyForm();

  const canEdit = isEditorOrAdmin(user);
  const canDownloadDocuments = user?.role !== "viewer" || user?.allowDownloads !== false;

  // requestClose: guard for backdrop, X button - closes the whole modal on discard
  const requestClose = useCallback(() => {
    if (editing && isDirty) {
      setDiscardAction("close");
      setShowDiscardDialog(true);
    } else {
      onClose();
    }
  }, [editing, isDirty, onClose]);

  // requestCancelEdit: guard for Cancel button in edit header - goes back to view mode on discard
  const requestCancelEdit = useCallback(() => {
    if (isDirty) {
      setDiscardAction("cancel-edit");
      setShowDiscardDialog(true);
    } else {
      setEditing(false);
      reset();
    }
  }, [isDirty, reset]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [contractResult, licensesResult] = await Promise.all([
        getContract(contractId),
        getContractLicenses(contractId),
      ]);
      if (cancelled) return;
      if (contractResult.data) setContract(contractResult.data);
      if (licensesResult.data) setLicenses(licensesResult.data);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [contractId]);

  // Edit

  const handleEditStart = () => {
    const snapshot = {
      publisherName: contract.publisherName,
      contractNumber: contract.contractNumber,
      notes: contract.notes || "",
    };
    setEditForm(snapshot);
    setInitial(snapshot);
    setEditing(true);
    setSaveError(null);
  };

  const handleEditSave = async () => {
    setSaving(true);
    setSaveError(null);
    const { data, error } = await updateContract(contractId, {
      publisher_name: editForm.publisherName.trim() || undefined,
      contract_number: editForm.contractNumber.trim() || undefined,
      notes: editForm.notes.trim() || null,
    });
    setSaving(false);
    if (error) { setSaveError(error); return; }
    setContract(data);
    reset();
    setEditing(false);
  };

  // Licenses

  const handleLicenseClick = (licenseId) => {
    onClose();
    onNavigateToLicense(licenseId);
  };

  return (
    <>
      <ModalShell
        titleId="dialog-title-contract"
        onClose={requestClose}
        onEscape={editing ? requestCancelEdit : requestClose}
        closeOnOverlayClick={false}
        overlayStyle={{ zIndex: 200 }}
        modalStyle={{ width: 680, maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
        header={(
          <div className="modal-hd" style={{ flexShrink: 0 }}>
          {loading ? (
            <h3 id="dialog-title-contract">Loading...</h3>
          ) : editing ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                className="fi"
                style={{ fontSize: 15, fontWeight: 600, flex: 1 }}
                value={editForm.publisherName}
                onChange={(e) => {
                  const updated = { ...editForm, publisherName: e.target.value };
                  setEditForm(updated);
                  check(updated);
                }}
                placeholder="Publisher name"
              />
              <input
                className="fi"
                style={{ fontSize: 13, fontFamily: "var(--font-mono)", width: 180 }}
                value={editForm.contractNumber}
                onChange={(e) => {
                  const updated = { ...editForm, contractNumber: e.target.value };
                  setEditForm(updated);
                  check(updated);
                }}
                placeholder="Contract number"
              />
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 id="dialog-title-contract" style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {contract?.publisherName}
              </h3>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                {contract?.contractNumber}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {!loading && canEdit && !editing && (
              <button
                className="btn btn-g"
                onClick={handleEditStart}
                title="Edit contract"
                aria-label="Edit contract"
                style={{ padding: "4px 10px" }}
              >
                <Icon name="edit" size={14} />
              </button>
            )}
            {editing && (
              <>
                <button className="btn btn-g" onClick={requestCancelEdit} disabled={saving}>
                  Cancel
                </button>
                <button className="btn btn-p" onClick={handleEditSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
            <button className="modal-close" aria-label="Close" onClick={requestClose}><Icon name="x" size={18} /></button>
          </div>
          </div>
        )}
      >

        {/* Body */}
        <div className="modal-bd" style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-3)" }}>
              Loading...
            </div>
          ) : (
            <>
              {saveError && (
                <div style={{ padding: "8px 12px", background: "var(--red-m)", color: "var(--red)", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  {saveError}
                </div>
              )}

              {/* Notes (edit mode) */}
              {editing && (
                <div className="fr" style={{ marginBottom: 16 }}>
                  <div className="fg">
                    <label htmlFor="contract-notes">Notes</label>
                    <textarea
                      id="contract-notes"
                      className="fi"
                      rows={3}
                      value={editForm.notes}
                      onChange={(e) => {
                        const updated = { ...editForm, notes: e.target.value };
                        setEditForm(updated);
                        check(updated);
                      }}
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>
              )}

              {/* Notes (view mode) */}
              {!editing && contract?.notes && (
                <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20, padding: "10px 14px", background: "var(--bg-2)", borderRadius: "var(--r)", lineHeight: 1.5 }}>
                  {contract.notes}
                </div>
              )}

              {/* Linked Licenses */}
              <div style={{ marginBottom: 24 }}>
                <button
                  type="button"
                  onClick={() => setLicensesOpen((v) => !v)}
                  onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setLicensesOpen((v) => !v); } }}
                  aria-expanded={licensesOpen}
                  style={{ margin: licensesOpen ? "0 0 12px" : 0, fontSize: 13, fontWeight: 600, fontFamily: "inherit", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", appearance: "none", background: "none", border: "none", padding: 0, width: "100%", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                  onFocus={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                  onBlur={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                >
                  <Icon name={licensesOpen ? "chevron-down" : "chevron-right"} size={14} />
                  Linked Licenses
                </button>
                {licensesOpen && (licenses.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                    No licenses found with this contract number.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {licenses.map((lic) => (
                      <button
                        key={lic.id}
                        type="button"
                        onClick={() => handleLicenseClick(lic.id)}
                        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleLicenseClick(lic.id); } }}
                        aria-label={`View license: ${lic.publisherName} — ${lic.softwareDescription}`}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "var(--bg-2)",
                          borderRadius: "var(--r)",
                          cursor: "pointer",
                          transition: "background 0.12s ease",
                          gap: 12,
                          appearance: "none",
                          border: "none",
                          width: "100%",
                          fontFamily: "inherit",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                        onFocus={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
                        onBlur={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {lic.publisherName} — {lic.softwareDescription}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                            {lic.startDate && lic.endDate
                              ? `${lic.startDate} → ${lic.endDate}`
                              : lic.startDate
                              ? `From ${lic.startDate}`
                              : lic.endDate
                              ? `Until ${lic.endDate}`
                              : "No dates"
                            }
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          {lic.expirationStatus === "renewed" && (
                            <span className="badge badge-renewed">
                              <span className="badge-dot" />Renewed
                            </span>
                          )}
                          {lic.expirationStatus === "pending_renewal" && (
                            <span className="badge badge-pending">
                              <span className="badge-dot" />Pending Renewal
                            </span>
                          )}
                          {lic.expirationStatus !== "renewed" && lic.expirationStatus !== "pending_renewal" && (
                            <Badge type={STATUS_BADGE_TYPE[lic.expirationStatus] ?? "gray"}>
                              {STATUS_LABEL[lic.expirationStatus] ?? lic.expirationStatus}
                            </Badge>
                          )}
                          <Icon name="arrow-right" size={14} color="var(--text-3)" />
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <ContractDocumentsSection
                contractId={contractId}
                canEdit={canEdit}
                canDownloadDocuments={canDownloadDocuments}
              />
            </>
          )}
        </div>
      </ModalShell>

      {showDiscardDialog && (
        <DiscardChangesDialog
          onDiscard={() => {
            reset();
            setShowDiscardDialog(false);
            if (discardAction === "close") onClose();
            else setEditing(false);
          }}
          onKeep={() => setShowDiscardDialog(false)}
        />
      )}
    </>
  );
}


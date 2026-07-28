import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "../../utils/formatting.js";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ContractModal from "../contracts/ContractModal.jsx";
import { isEditorOrAdmin } from "../../utils/helpers.js";
import { getContracts, createContract, deleteContract } from "../../api/contracts.js";
import { queryKeys } from "../../queryKeys.js";
import { invalidateContracts } from "../../queryInvalidation.js";

async function fetchContractsData() {
  const { data, error } = await getContracts();
  if (error) throw new Error(error);
  return data ?? [];
}

function NewContractModal({ onClose, onCreate, showError }) {
  const [form, setForm] = useState({ contractNumber: "", publisherName: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.contractNumber.trim() || !form.publisherName.trim()) {
      showError("Contract number and publisher name are required.");
      return;
    }
    setSaving(true);
    const { data, error } = await createContract({
      contract_number: form.contractNumber.trim(),
      publisher_name: form.publisherName.trim(),
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) { showError(error); return; }
    onCreate(data);
  };

  return (
    <ModalShell
      title="New Contract"
      titleId="dialog-title-new-contract"
      onClose={onClose}
      overlayStyle={{ zIndex: 200 }}
      modalStyle={{ width: 480, maxWidth: "92vw" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={handleSubmit} disabled={saving}>
            {saving ? "Creating..." : "Create Contract"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <div className="fr">
          <div className="fg">
            <label htmlFor="new-contract-number">Contract Number *</label>
            <input id="new-contract-number" className="fi" value={form.contractNumber}
              onChange={(e) => setForm((s) => ({ ...s, contractNumber: e.target.value }))}
              placeholder="CTR-2026-001" />
          </div>
        </div>
        <div className="fr">
          <div className="fg">
            <label htmlFor="new-contract-publisher">Publisher Name *</label>
            <input id="new-contract-publisher" className="fi" value={form.publisherName}
              onChange={(e) => setForm((s) => ({ ...s, publisherName: e.target.value }))}
              placeholder="Software publisher" />
          </div>
        </div>
        <div className="fr">
          <div className="fg">
            <label htmlFor="new-contract-notes">Notes</label>
            <textarea id="new-contract-notes" className="fi" rows={3} value={form.notes}
              onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
              placeholder="Contract notes" />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function ContractTile({ contract, onOpen, onDelete, canEdit, userSettings }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <div
        style={{
          position: "relative",
          width: "100%",
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(contract.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(contract.id);
            }
          }}
          aria-label={`Open contract ${contract.contractNumber} — ${contract.publisherName}`}
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border)",
            borderRadius: "var(--rl)",
            padding: 18,
            paddingRight: canEdit ? 52 : 18,
            cursor: "pointer",
            transition: "border-color 0.15s ease",
            width: "100%",
            textAlign: "left",
          }}
          onMouseEnter={(event) => { event.currentTarget.style.borderColor = "var(--accent)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
          onFocus={(event) => { event.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
        >
          <div style={{ minWidth: 0, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {contract.publisherName}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {contract.contractNumber}
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="list" size={12} color="var(--text-3)" />
              {contract.licenseCount} license{contract.licenseCount !== 1 ? "s" : ""}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="file" size={12} color="var(--text-3)" />
              {contract.documentCount} document{contract.documentCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Added {formatDateTime(contract.createdAt, userSettings)}
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            title="Delete contract"
            aria-label={`Delete contract ${contract.contractNumber}`}
            style={{ position: "absolute", top: 16, right: 14, background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "4px 6px", borderRadius: 4 }}
            onMouseEnter={(event) => { event.currentTarget.style.color = "var(--red)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-3)"; }}
            onFocus={(event) => { event.currentTarget.style.color = "var(--red)"; }}
            onBlur={(event) => { event.currentTarget.style.color = "var(--text-3)"; }}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Delete Contract"
          message={`Delete contract "${contract.contractNumber}" for ${contract.publisherName}? All folders and documents will be permanently removed.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { setShowConfirm(false); onDelete(contract.id); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

const EMPTY_CONTRACTS = [];

export default function ContractsPage({
  user,
  userSettings,
  showError,
  onNavigateToLicense,
  openContractId,
  onClearOpenContractId,
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.contracts,
    queryFn: fetchContractsData,
  });
  const contracts = data ?? EMPTY_CONTRACTS;
  const contractsLoading = isLoading;

  useEffect(() => {
    if (error) showError?.(error.message);
  }, [error, showError]);

  const [selectedContractId, setSelectedContractId] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const handleDeleteContract = useCallback(async (id) => {
    const { error: deleteError } = await deleteContract(id);
    if (deleteError) { showError(deleteError); return; }
    queryClient.setQueryData(queryKeys.contracts, (prev) =>
      prev ? prev.filter((c) => c.id !== id) : prev
    );
  }, [showError, queryClient]);

  useEffect(() => {
    if (openContractId) {
      setSelectedContractId(openContractId);
      onClearOpenContractId?.();
    }
  }, [openContractId, onClearOpenContractId]);

  const canEdit = isEditorOrAdmin(user);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Contracts</h2>
          <p>{contracts.length} contract{contracts.length !== 1 ? "s" : ""}</p>
        </div>
        {canEdit && (
          <button className="btn btn-p" onClick={() => setShowNewModal(true)}>
            <Icon name="plus" size={14} /> New Contract
          </button>
        )}
      </div>

      <div className="page-content">
        {contractsLoading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-3)" }}>
            Loading contracts...
          </div>
        ) : contracts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-3)", fontSize: 14 }}>
            <Icon name="file" size={32} color="var(--border)" />
            <p style={{ marginTop: 12 }}>
              {user?.role === "viewer"
                ? "No contracts found for your department."
                : "No contracts yet. Create one to start linking agreements to your licenses."
              }
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {contracts.map((contract) => (
              <ContractTile
                key={contract.id}
                contract={contract}
                canEdit={canEdit}
                userSettings={userSettings}
                onOpen={(id) => setSelectedContractId(id)}
                onDelete={handleDeleteContract}
              />
            ))}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewContractModal
          onClose={() => setShowNewModal(false)}
          onCreate={(contract) => {
            setShowNewModal(false);
            invalidateContracts(queryClient);
            setSelectedContractId(contract.id);
          }}
          showError={showError}
        />
      )}

      {selectedContractId && (
        <ContractModal
          contractId={selectedContractId}
          onClose={() => {
            setSelectedContractId(null);
            invalidateContracts(queryClient);
          }}
          onNavigateToLicense={onNavigateToLicense}
          user={user}
          userSettings={userSettings}
        />
      )}
    </>
  );
}

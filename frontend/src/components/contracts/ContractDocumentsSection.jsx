import React, { useState, useEffect } from "react";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import {
  documentAvailabilityHelp,
  documentAvailabilityLabel,
  isFileAvailable,
} from "../../utils/documentAvailability.js";
import {
  createFolder,
  updateFolder,
  deleteFolder,
  getContract,
  getContractDocuments,
  uploadContractDocument,
  downloadContractDocument,
  deleteContractDocument,
} from "../../api/contracts.js";

/**
 * Self-contained documents + folder management section for ContractModal.
 *
 * Props:
 *   contractId           {number|string}
 *   canEdit              {boolean}
 *   canDownloadDocuments {boolean}
 */
export default function ContractDocumentsSection({ contractId, canEdit, canDownloadDocuments, showError, onChanged }) {
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loadError, setLoadError] = useState(false);

  // Folder management
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState(null);

  // Document management
  const [uploading, setUploading] = useState(false);
  const [deleteDocConfirm, setDeleteDocConfirm] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Collapsible sections
  const [documentsOpen, setDocumentsOpen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [docsResult, contractResult] = await Promise.all([
        getContractDocuments(contractId),
        getContract(contractId),
      ]);
      if (cancelled) return;
      setLoadError(Boolean(docsResult.error || contractResult.error));
      if (docsResult.error) showError?.(docsResult.error);
      if (contractResult.error) showError?.(contractResult.error);
      if (docsResult.data) setDocuments(docsResult.data);
      if (contractResult.data) setFolders(contractResult.data.folders ?? []);
    }
    load();
    return () => { cancelled = true; };
  }, [contractId, showError]);

  const reloadDocs = async () => {
    const { data, error } = await getContractDocuments(contractId);
    setLoadError(Boolean(error));
    if (data) setDocuments(data);
    else if (error) showError?.(error);
  };

  const reloadContract = async () => {
    const { data, error } = await getContract(contractId);
    setLoadError(Boolean(error));
    if (data) setFolders(data.folders ?? []);
    else if (error) showError?.(error);
  };

  // Folders

  const handleAddFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setAddingFolder(true);
    const { error } = await createFolder(contractId, { name });
    setAddingFolder(false);
    if (error) { showError?.(error); return; }
    setNewFolderName("");
    await reloadContract();
    onChanged?.();
  };

  const handleRenameFolder = async (folderId) => {
    const name = renameFolderName.trim();
    if (!name) { setRenamingFolderId(null); return; }
    const { error } = await updateFolder(contractId, folderId, { name });
    if (error) { showError?.(error); return; }
    setRenamingFolderId(null);
    await reloadContract();
    onChanged?.();
  };

  const handleDeleteFolder = async (folderId) => {
    const { error } = await deleteFolder(contractId, folderId);
    if (error) { setDeleteFolderConfirm(null); showError?.(error); return; }
    setDeleteFolderConfirm(null);
    await reloadContract();
    onChanged?.();
  };

  const toggleFolder = (folderId) =>
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));

  // Documents

  const handleUpload = async (file, folderId = null) => {
    setUploading(true);
    const { error } = await uploadContractDocument(contractId, file, folderId);
    setUploading(false);
    if (error) { showError?.(error); return; }
    await reloadDocs();
    await reloadContract();
    onChanged?.();
  };

  const handleDeleteDoc = async (doc) => {
    const { error } = await deleteContractDocument(contractId, doc.id);
    if (error) { setDeleteDocConfirm(null); showError?.(error); return; }
    setDeleteDocConfirm(null);
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    await reloadContract();
    onChanged?.();
  };

  const handleDownload = async (doc) => {
    if (!isFileAvailable(doc)) return;
    setDownloadingId(doc.id);
    try {
      const { error } = await downloadContractDocument(contractId, doc.id, doc.originalFilename);
      if (error) showError?.(error);
    } finally {
      setDownloadingId(null);
    }
  };

  // Derived

  const generalDocs = documents.filter((d) => d.folderId == null);

  return (
    <>
      {/* Documents & Folders */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: documentsOpen ? 12 : 0 }}>
          <button
            type="button"
            onClick={() => setDocumentsOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setDocumentsOpen((v) => !v); } }}
            aria-expanded={documentsOpen}
            style={{ margin: 0, fontSize: 13, fontWeight: 600, fontFamily: "inherit", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", appearance: "none", background: "none", border: "none", padding: 0, textAlign: "left" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
            onFocus={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onBlur={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
          >
            <Icon name={documentsOpen ? "chevron-down" : "chevron-right"} size={14} />
            Documents &amp; Folders
          </button>
          {canEdit && documentsOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="fi"
                style={{ fontSize: 12, padding: "3px 8px", width: 160 }}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddFolder(); }}
                placeholder="New folder name..."
              />
              <button
                className="btn btn-g"
                style={{ padding: "3px 8px", fontSize: 12 }}
                onClick={handleAddFolder}
                disabled={addingFolder || !newFolderName.trim()}
              >
                <Icon name="plus" size={12} /> Folder
              </button>
            </div>
          )}
        </div>

        {documentsOpen && (
          <>
            {loadError && (
              <div role="alert" style={{ marginBottom: 10, color: "var(--red)", fontSize: 12 }}>
                Contract documents or folders could not be loaded. Existing records remain available; try again later.
              </div>
            )}
            {/* General folder (system - no rename/delete) */}
            {(() => {
              const generalIsExpanded = !!expandedFolders["general"];
              return (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: generalIsExpanded ? 8 : 0 }}>
                    <button
                      type="button"
                      onClick={() => toggleFolder("general")}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleFolder("general"); } }}
                      aria-expanded={generalIsExpanded}
                      aria-label="Toggle General folder"
                      style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer", color: "var(--text)", appearance: "none", background: "none", border: "none", padding: 0, fontFamily: "inherit", textAlign: "left" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                      onFocus={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                      onBlur={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                    >
                      <Icon name={generalIsExpanded ? "chevron-down" : "chevron-right"} size={12} color="var(--text-3)" />
                      <Icon name="folder" size={14} color="var(--text-3)" />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>General</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>({generalDocs.length})</span>
                    </button>
                  </div>
                  {generalIsExpanded && (
                    <DocSection
                      docs={generalDocs}
                      canEdit={canEdit}
                      canDownload={canDownloadDocuments}
                      uploading={uploading}
                      downloadingId={downloadingId}
                      onUpload={(file) => handleUpload(file, null)}
                      onDownload={handleDownload}
                      onDeleteRequest={(doc) => setDeleteDocConfirm(doc)}
                    />
                  )}
                </div>
              );
            })()}

            {/* Per-folder sections */}
            {folders.map((folder) => {
              const isExpanded = !!expandedFolders[folder.id];
              const folderDocs = documents.filter((d) => d.folderId === folder.id);
              return (
                <div key={folder.id} style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: isExpanded ? 8 : 0 }}>
                    {renamingFolderId === folder.id ? (
                      <input
                        className="fi"
                        style={{ fontSize: 13, fontWeight: 600, flex: 1, padding: "2px 6px" }}
                        value={renameFolderName}
                        autoFocus
                        onChange={(e) => setRenameFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameFolder(folder.id);
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenamingFolderId(null);
                          }
                        }}
                        onBlur={() => handleRenameFolder(folder.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleFolder(folder.id)}
                        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleFolder(folder.id); } }}
                        aria-expanded={isExpanded}
                        aria-label={`Toggle ${folder.name} folder`}
                        style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer", color: "var(--text)", appearance: "none", background: "none", border: "none", padding: 0, fontFamily: "inherit", textAlign: "left" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                        onFocus={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                        onBlur={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                      >
                        <Icon name={isExpanded ? "chevron-down" : "chevron-right"} size={12} color="var(--text-3)" />
                        <Icon name="folder" size={14} color="var(--text-3)" />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {folder.name}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>({folderDocs.length})</span>
                      </button>
                    )}
                    {canEdit && renamingFolderId !== folder.id && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          title="Rename folder"
                          aria-label="Rename folder"
                          onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}
                        >
                          <Icon name="edit" size={12} />
                        </button>
                        <button
                          title="Delete folder"
                          aria-label="Delete folder"
                          onClick={() => setDeleteFolderConfirm(folder)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  {isExpanded && (
                    <DocSection
                      docs={folderDocs}
                      canEdit={canEdit}
                      canDownload={canDownloadDocuments}
                      uploading={uploading}
                      downloadingId={downloadingId}
                      onUpload={(file) => handleUpload(file, folder.id)}
                      onDownload={handleDownload}
                      onDeleteRequest={(doc) => setDeleteDocConfirm(doc)}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {deleteFolderConfirm && (
        <ConfirmDialog
          title="Delete Folder"
          message={`Delete folder "${deleteFolderConfirm.name}"? This will only work if the folder is empty.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDeleteFolder(deleteFolderConfirm.id)}
          onCancel={() => setDeleteFolderConfirm(null)}
        />
      )}

      {deleteDocConfirm && (
        <ConfirmDialog
          title="Delete Document"
          message={`Delete "${deleteDocConfirm.originalFilename}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDeleteDoc(deleteDocConfirm)}
          onCancel={() => setDeleteDocConfirm(null)}
        />
      )}
    </>
  );
}

function DocSection({ docs, canEdit, canDownload = true, hideUpload, uploading, downloadingId, onUpload, onDownload, onDeleteRequest }) {
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = "";
  };

  const showUpload = canEdit && !hideUpload;

  return (
    <div style={{ background: "var(--bg-2)", borderRadius: "var(--r)", padding: "10px 14px" }}>
      {docs.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: showUpload ? 8 : 0 }}>
          No documents.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: showUpload ? 8 : 0 }}>
          {docs.map((doc) => (
            <div
              key={doc.id}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Icon name="file" size={13} color="var(--text-3)" />
              <button
                onClick={() => canDownload && onDownload(doc)}
                disabled={!canDownload || !isFileAvailable(doc) || downloadingId === doc.id}
                style={{ background: "none", border: "none", cursor: canDownload && isFileAvailable(doc) ? "pointer" : "default", color: canDownload && isFileAvailable(doc) ? "var(--accent)" : "var(--text-2)", fontSize: 12, padding: 0, textAlign: "left", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={isFileAvailable(doc) ? doc.originalFilename : documentAvailabilityHelp(doc)}
              >
                {downloadingId === doc.id ? "Downloading..." : doc.originalFilename}
              </button>
              {!isFileAvailable(doc) && (
                <span className="badge badge-orange" title={documentAvailabilityHelp(doc)}>
                  {documentAvailabilityLabel(doc)}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => onDeleteRequest(doc)}
                  title="Delete document"
                  aria-label="Delete document"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px", flexShrink: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {showUpload && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: uploading ? "not-allowed" : "pointer", color: uploading ? "var(--text-3)" : "var(--accent)", userSelect: "none" }}>
          <Icon name="upload" size={12} />
          {uploading ? "Uploading..." : "Upload file"}
          <input
            type="file"
            style={{ display: "none" }}
            onChange={handleFileChange}
            disabled={uploading}
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt,.docx,.doc"
          />
        </label>
      )}
    </div>
  );
}

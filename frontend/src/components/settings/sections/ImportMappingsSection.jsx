import { useState, useEffect } from "react";
import { listImportMappings, deleteImportMapping, putImportMapping } from "../../../api/csvImport.js";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

export default function ImportMappingsSection({ isOpen, isDirty, onToggle, onError, onToast }) {
  const [importMappings, setImportMappings] = useState([]);
  const [importMappingsLoading, setImportMappingsLoading] = useState(false);
  const [mappingEditId, setMappingEditId] = useState(null);
  const [mappingEditName, setMappingEditName] = useState("");
  const [mappingSaving, setMappingSaving] = useState(false);
  const [deleteMappingPending, setDeleteMappingPending] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setImportMappingsLoading(true);
    listImportMappings().then(({ data, error }) => {
      setImportMappingsLoading(false);
      if (!error && data) setImportMappings(data);
    });
  }, [isOpen]);

  const handleDeleteMappingConfirm = async () => {
    if (!deleteMappingPending) return;
    const { error } = await deleteImportMapping(deleteMappingPending.id);
    if (error) { onError(error); setDeleteMappingPending(null); return; }
    setImportMappings(prev => prev.filter(m => m.id !== deleteMappingPending.id));
    onToast(`Preset "${deleteMappingPending.name}" deleted.`, "info");
    setDeleteMappingPending(null);
  };

  const handleRenameMapping = async (id) => {
    if (!mappingEditName.trim()) return;
    setMappingSaving(true);
    const { data, error } = await putImportMapping(id, mappingEditName.trim());
    setMappingSaving(false);
    if (error) { onError(error); return; }
    setImportMappings(prev => prev.map(m => m.id === id ? { ...m, name: data.name } : m));
    setMappingEditId(null);
    setMappingEditName("");
    onToast("Preset renamed.", "info");
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="importMappings" icon="upload" title="Import Mapping Presets" description="Saved column mappings from the External Tool Importer. Rename or delete presets here." isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            {importMappingsLoading ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8 }}>Loading…</p>
            ) : importMappings.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8 }}>No saved presets yet. Presets are created during import.</p>
            ) : (
              <table className="mapping-matched-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Name</th>
                    <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Columns</th>
                    <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {importMappings.map(m => (
                    <tr key={m.id}>
                      <td>
                        {mappingEditId === m.id ? (
                          <input className="fi" style={{ fontSize: 12, padding: "2px 6px" }} value={mappingEditName} onChange={e => setMappingEditName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleRenameMapping(m.id); if (e.key === "Escape") { setMappingEditId(null); setMappingEditName(""); } }} autoFocus />
                        ) : (
                          <span style={{ fontSize: 13 }}>{m.name}</span>
                        )}
                      </td>
                      <td><span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>{Array.isArray(m.mapping) ? m.mapping.length : 0}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          {mappingEditId === m.id ? (
                            <>
                              <button type="button" className="btn btn-p" style={{ fontSize: 11, padding: "2px 8px" }} disabled={mappingSaving || !mappingEditName.trim()} onClick={() => handleRenameMapping(m.id)}>Save</button>
                              <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => { setMappingEditId(null); setMappingEditName(""); }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => { setMappingEditId(m.id); setMappingEditName(m.name); }}>Rename</button>
                              <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "2px 8px", color: "var(--red-text)" }} onClick={() => setDeleteMappingPending({ id: m.id, name: m.name })}>Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {deleteMappingPending && (
        <ConfirmDialog title="Delete Preset" message={`Delete preset "${deleteMappingPending.name}"? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDeleteMappingConfirm} onCancel={() => setDeleteMappingPending(null)} />
      )}
    </>
  );
}

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
            <div className="set-section-stack">
              {importMappingsLoading ? (
                <p className="set-muted-text">Loading...</p>
              ) : importMappings.length === 0 ? (
                <p className="set-muted-text">No saved presets yet. Presets are created during import.</p>
              ) : (
                <table className="mapping-matched-table set-list-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Columns</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importMappings.map(m => (
                      <tr key={m.id}>
                        <td>
                          {mappingEditId === m.id ? (
                            <input className="fi set-compact-input" value={mappingEditName} onChange={e => setMappingEditName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleRenameMapping(m.id); if (e.key === "Escape") { setMappingEditId(null); setMappingEditName(""); } }} autoFocus />
                          ) : (
                            <span className="set-list-label">{m.name}</span>
                          )}
                        </td>
                        <td><span className="set-list-mono">{Array.isArray(m.mapping) ? m.mapping.length : 0}</span></td>
                        <td>
                          <div className="set-table-actions">
                            {mappingEditId === m.id ? (
                              <>
                                <button type="button" className="btn btn-p set-compact-button" disabled={mappingSaving || !mappingEditName.trim()} onClick={() => handleRenameMapping(m.id)}>Save</button>
                                <button type="button" className="btn btn-g set-compact-button" onClick={() => { setMappingEditId(null); setMappingEditName(""); }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="btn btn-g set-compact-button" onClick={() => { setMappingEditId(m.id); setMappingEditName(m.name); }}>Rename</button>
                                <button type="button" className="btn btn-g set-compact-button set-danger-action" onClick={() => setDeleteMappingPending({ id: m.id, name: m.name })}>Delete</button>
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
      </div>
      {deleteMappingPending && (
        <ConfirmDialog title="Delete Preset" message={`Delete preset "${deleteMappingPending.name}"? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDeleteMappingConfirm} onCancel={() => setDeleteMappingPending(null)} />
      )}
    </>
  );
}

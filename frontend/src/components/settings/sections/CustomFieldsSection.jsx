import { useState, useEffect } from "react";
import { listCustomFields, createCustomField, updateCustomField, deleteCustomField, updateCustomFieldSection } from "../../../api/settings.js";
import { getCustomFieldSectionLabel } from "../../../utils/customFieldPresentation.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const CUSTOM_FIELD_TYPE_LABELS = { text: "Text", currency: "Currency", date: "Date", boolean: "True/False" };
const CUSTOM_FIELD_SECTION_KEYS = ["identity", "dates", "commercial", "people", "documents", "maintenance", "notes"];

export default function CustomFieldsSection({ isOpen, isDirty, onToggle, onError, onToast, onCustomFieldsChanged }) {
  const [customFields, setCustomFields] = useState([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [customFieldsSaving, setCustomFieldsSaving] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [deleteFieldPending, setDeleteFieldPending] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomFieldsLoading(true);
    listCustomFields().then(({ data, error }) => {
      setCustomFieldsLoading(false);
      if (!error && data) setCustomFields(data);
    });
  }, [isOpen]);

  const handleAddCustomField = async () => {
    if (!newFieldName.trim()) return;
    setCustomFieldsSaving(true);
    const { data, error } = await createCustomField({ name: newFieldName.trim(), fieldType: newFieldType, displayOrder: customFields.length });
    setCustomFieldsSaving(false);
    if (error) { onError(error); return; }
    setCustomFields(prev => [...prev, data]);
    setNewFieldName(""); setNewFieldType("text"); setShowAddField(false);
    onCustomFieldsChanged?.();
    onToast("Custom field added.", "info");
  };

  const handleDeleteCustomFieldConfirm = async () => {
    if (!deleteFieldPending) return;
    const { data, error } = await deleteCustomField(deleteFieldPending.id);
    if (error) { onError(error); setDeleteFieldPending(null); return; }
    setCustomFields(prev => prev.filter(f => f.id !== deleteFieldPending.id));
    onCustomFieldsChanged?.();
    onToast(`Field "${deleteFieldPending.name}" deleted.${data?.affectedLicenses ? ` ${data.affectedLicenses} license value(s) removed.` : ""}`, "info");
    setDeleteFieldPending(null);
  };

  const handleMoveCustomField = async (index, direction) => {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= customFields.length) return;
    const previous = customFields;
    const updated = [...customFields];
    const a = { ...updated[index], displayOrder: updated[swapIndex].displayOrder };
    const b = { ...updated[swapIndex], displayOrder: updated[index].displayOrder };
    updated[index] = a; updated[swapIndex] = b;
    updated.sort((x, y) => x.displayOrder - y.displayOrder);
    setCustomFields(updated);
    const results = await Promise.all([
      updateCustomField(a.id, { displayOrder: a.displayOrder }),
      updateCustomField(b.id, { displayOrder: b.displayOrder }),
    ]);
    const error = results.find((result) => result?.error)?.error;
    if (error) {
      onError(error);
      setCustomFields(previous);
      return;
    }
    onCustomFieldsChanged?.();
  };

  const handleUpdateCustomFieldSection = async (fieldId, section) => {
    const previous = customFields;
    setCustomFields(prev => prev.map(f => f.id === fieldId ? { ...f, section } : f));
    const { error } = await updateCustomFieldSection(fieldId, section);
    if (error) {
      onError(error);
      setCustomFields(previous);
      return;
    }
    onCustomFieldsChanged?.();
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="customFields" icon="sliders" title="Custom Fields" description="Define additional fields that appear on all license records (admin only)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div style={{ marginTop: 12 }}>
              {customFieldsLoading ? (
                <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading...</p>
              ) : customFields.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>No custom fields defined yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-2)", fontWeight: 500 }}>Name</th>
                      <th scope="col" style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-2)", fontWeight: 500 }}>Type</th>
                      <th scope="col" style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-2)", fontWeight: 500 }}>Key</th>
                      <th scope="col" style={{ width: 160, textAlign: "left", padding: "4px 8px", color: "var(--text-2)", fontWeight: 500 }}>Section</th>
                      <th scope="col" style={{ width: 80, padding: "4px 8px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customFields.map((field, index) => (
                      <tr key={field.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px" }}>{field.name}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{CUSTOM_FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{field.fieldKey}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <select className="fi fi-select" style={{ fontSize: 11, padding: "2px 6px", height: "auto" }} value={field.section ?? ""} onChange={e => handleUpdateCustomFieldSection(field.id, e.target.value || null)} aria-label={`Section for ${field.name}`}>
                            <option value="">— {getCustomFieldSectionLabel(null)} —</option>
                            {CUSTOM_FIELD_SECTION_KEYS.map((section) => (
                              <option key={section} value={section}>{getCustomFieldSectionLabel(section)}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "6px 8px", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <button type="button" className="btn btn-g" style={{ padding: "2px 6px", fontSize: 12 }} disabled={index === 0} onClick={() => handleMoveCustomField(index, "up")} aria-label={`Move ${field.name} up`}>↑</button>
                          <button type="button" className="btn btn-g" style={{ padding: "2px 6px", fontSize: 12 }} disabled={index === customFields.length - 1} onClick={() => handleMoveCustomField(index, "down")} aria-label={`Move ${field.name} down`}>↓</button>
                          <button type="button" className="btn btn-g" style={{ padding: "2px 6px", fontSize: 12, color: "var(--red-text)" }} onClick={() => setDeleteFieldPending({ id: field.id, name: field.name })} aria-label={`Delete ${field.name}`}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {showAddField ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div className="fg" style={{ flex: 2, minWidth: 160 }}>
                    <label htmlFor="new-custom-field-name">Field Name</label>
                    <input id="new-custom-field-name" className="fi" value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} placeholder="e.g. Contract Owner" onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomField(); }} />
                  </div>
                  <div className="fg" style={{ flex: 1, minWidth: 100 }}>
                    <label htmlFor="new-custom-field-type">Type</label>
                    <select id="new-custom-field-type" className="fi" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)}>
                      <option value="text">Text</option>
                      <option value="currency">Currency</option>
                      <option value="date">Date</option>
                      <option value="boolean">True/False</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6, paddingBottom: 1 }}>
                    <button type="button" className="btn btn-p" onClick={handleAddCustomField} disabled={!newFieldName.trim() || customFieldsSaving} style={{ fontSize: 13 }}>{customFieldsSaving ? "Adding..." : "Add"}</button>
                    <button type="button" className="btn btn-g" onClick={() => { setShowAddField(false); setNewFieldName(""); setNewFieldType("text"); }} style={{ fontSize: 13 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-g" onClick={() => setShowAddField(true)} style={{ fontSize: 13 }}>
                  <Icon name="plus" size={13} /> Add Field
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {deleteFieldPending && (
        <ConfirmDialog title="Delete Custom Field" message={`Delete field "${deleteFieldPending.name}"? This will permanently remove this field and all stored values across all licenses. This cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDeleteCustomFieldConfirm} onCancel={() => setDeleteFieldPending(null)} />
      )}
    </>
  );
}

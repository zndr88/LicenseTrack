// frontend/src/components/licenses/detail/NotesSection.jsx
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

export function NotesSection({
  license,
  perms,
  userSettings,
  vis,
  isOpen,
  onToggle,
  notesPreview,
  openFieldEdit,
  cfBySection,
  customFieldValues,
  customFieldsLoading,
  makeCustomFieldSaveFn,
  closeFieldEdit,
}) {
  if (!vis.notes) return null;
  return (
    <>
      <DetailSectionHeader sectionKey="notes" isOpen={isOpen} onToggle={onToggle}>
        {notesPreview && !isOpen ? `Notes — ${notesPreview}` : "Notes"}
      </DetailSectionHeader>
      {isOpen && (
        <div className="dp-section-body" id="dp-section-notes">
          <div className="dp-field" style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 0 }}>
            <div style={{ flex: 1, fontSize: 12, color: license.notes ? "var(--text-2)" : "var(--text-3)", whiteSpace: "pre-wrap", lineHeight: 1.5, fontStyle: license.notes ? "normal" : "italic" }}>
              {license.notes || "No notes yet"}
            </div>
            {perms.canEdit && (
              <button type="button" className="dp-field-edit-icon" aria-label="Edit notes"
                style={{ marginLeft: 0, marginTop: 1 }}
                onClick={() => openFieldEdit({ fieldKey: "notes", fieldLabel: "Notes", currentValue: license.notes || "", inputType: "textarea" })}
              >
                <Icon name="edit" size={11} />
              </button>
            )}
          </div>
          <CustomFieldRows
            fieldDefs={cfBySection["notes"] ?? []}
            values={customFieldValues}
            visibleInDetail={vis}
            license={license}
            userSettings={userSettings}
            canEdit={perms.canEdit}
            onOpenFieldEdit={openFieldEdit}
            makeCustomFieldSaveFn={makeCustomFieldSaveFn}
            onCloseFieldEdit={closeFieldEdit}
            loading={customFieldsLoading}
          />
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}

export function CatchallCustomFieldsSection({
  license,
  perms,
  userSettings,
  vis,
  isOpen,
  onToggle,
  cfBySection,
  customFieldValues,
  customFieldsLoading,
  openFieldEdit,
  makeCustomFieldSaveFn,
  closeFieldEdit,
}) {
  const catchallDefs = cfBySection["__catchall__"] ?? [];
  const hasVisible = catchallDefs.some((def) => vis[`cf_${def.fieldKey}`] ?? true);
  if (!hasVisible) return null;

  return (
    <>
      <DetailSectionHeader sectionKey="customFields" title="Custom Fields" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-custom-fields">
          <CustomFieldRows
            fieldDefs={catchallDefs}
            values={customFieldValues}
            visibleInDetail={vis}
            license={license}
            userSettings={userSettings}
            canEdit={perms.canEdit}
            onOpenFieldEdit={openFieldEdit}
            makeCustomFieldSaveFn={makeCustomFieldSaveFn}
            onCloseFieldEdit={closeFieldEdit}
            loading={customFieldsLoading}
          />
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}

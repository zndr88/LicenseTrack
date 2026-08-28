import Icon from "../ui/Icon.jsx";
import { isAdmin } from "../../utils/helpers.js";

export function SectionHeader({
  sectionKey,
  icon,
  title,
  description,
  iconColor = "var(--accent)",
  isOpen,
  isDirty,
  onToggle,
}) {
  return (
    <button
      type="button"
      className="settings-section-header"
      onClick={() => onToggle(sectionKey)}
      aria-expanded={!!isOpen}
    >
      <div>
        <h3 className="settings-section-title">
          <Icon name={icon} size={16} color={iconColor} /> {title}
          {isDirty && <span className="settings-section-dirty" />}
        </h3>
        {description && <p className="settings-section-description">{description}</p>}
      </div>
      <span className={`settings-section-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}

export function SectionSaveButton({ sectionKey, isDirty, isSaving, onSave }) {
  return (
    <div className="set-save-row">
      <button
        type="button"
        className="btn btn-p set-save-button"
        disabled={!isDirty || isSaving}
        onClick={() => onSave(sectionKey)}
      >
        {isSaving && isDirty ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function SettingsTabs({ activeTab, onChange, user }) {
  return (
    <div className="settings-tabs">
      {[
        ["my", "My Settings"],
        ["admin", "Admin Settings"],
        ...(isAdmin(user) ? [["auditlog", "Audit Log"]] : []),
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`settings-tab ${activeTab === id ? "active" : ""}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

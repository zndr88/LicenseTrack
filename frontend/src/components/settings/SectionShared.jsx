import Icon from "../ui/Icon.jsx";
import { isAdmin } from "../../utils/helpers.js";

export function SectionHeader({ sectionKey, icon, title, description, iconColor = "var(--accent)", isOpen, isDirty, onToggle }) {
  return (
    <button
      type="button"
      style={{ appearance: "none", background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: "inherit", color: "inherit", width: "100%", textAlign: "left", display: "flex", alignItems: "flex-start", justifyContent: "space-between", cursor: "pointer" }}
      onClick={() => onToggle(sectionKey)}
      aria-expanded={!!isOpen}
      onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}
    >
      <div>
        <h3 style={{ margin: 0 }}>
          <Icon name={icon} size={16} color={iconColor} /> {title}
          {isDirty && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)", display: "inline-block", marginLeft: 6, verticalAlign: "middle" }} />
          )}
        </h3>
        {description && <p style={{ margin: "4px 0 0" }}>{description}</p>}
      </div>
      <span
        aria-hidden="true"
        style={{ fontSize: 14, color: "var(--text-3)", paddingTop: 3, flexShrink: 0, marginLeft: 8, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}
      >▸</span>
    </button>
  );
}

export function SectionSaveButton({ sectionKey, isDirty, isSaving, onSave }) {
  return (
    <div className="set-save-row">
      <button
        type="button"
        className="btn btn-p"
        disabled={!isDirty || isSaving}
        onClick={() => onSave(sectionKey)}
        style={{ fontSize: 13 }}
      >
        {isSaving && isDirty ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function SettingsTabs({ activeTab, onChange, user }) {
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
      {[
        ["my", "My Settings"],
        ["admin", "Admin Settings"],
        ...(isAdmin(user) ? [["auditlog", "Audit Log"]] : []),
      ].map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            background: "none",
            border: "none",
            borderBottom: activeTab === id ? "2px solid var(--accent)" : "2px solid transparent",
            color: activeTab === id ? "var(--accent)" : "var(--text-2)",
            fontWeight: activeTab === id ? 600 : 400,
            padding: "8px 18px",
            cursor: "pointer",
            fontSize: 14,
            marginBottom: -1,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

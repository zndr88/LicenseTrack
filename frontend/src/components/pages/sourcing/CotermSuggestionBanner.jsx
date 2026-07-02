import Icon from "../../ui/Icon.jsx";

export default function CotermSuggestionBanner({ cotermGroups, canEdit, onSelectGroup }) {
  if (cotermGroups.length === 0) return null;

  return (
    <div style={{
      background: "var(--orange-m)", border: "1px solid var(--orange-border)",
      borderRadius: "var(--r)", padding: "12px 14px", marginBottom: 16,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "var(--orange-text)" }}>
        <Icon name="alert" size={14} color="var(--orange-text)" />
        Coterm Renewal Opportunity
      </div>
      {cotermGroups.map((group, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
            <strong>{group.ids.length}</strong> {group.publisher} renewal sourcing items share the same end date
            {group.endDate ? ` (${group.endDate})` : ""} - consider merging into a single renewal.
          </span>
          {canEdit && (
            <button
              className="btn btn-g btn-sm"
              style={{ fontSize: 11, whiteSpace: "nowrap" }}
              onClick={() => onSelectGroup(group.ids)}
            >
              Select for merge
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

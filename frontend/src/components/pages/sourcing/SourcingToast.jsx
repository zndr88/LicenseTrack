import Icon from "../../ui/Icon.jsx";

export default function SourcingToast({ toast, onDismiss }) {
  if (!toast) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
      borderRadius: "var(--r)", marginBottom: 12, fontSize: 13,
      background: toast.type === "error" ? "var(--red-dim)" : "var(--green-dim)",
      border: `1px solid ${toast.type === "error" ? "var(--red-border)" : "var(--green-border)"}`,
      color: toast.type === "error" ? "var(--red-text)" : "var(--green-text)",
    }}>
      <Icon name={toast.type === "error" ? "alert" : "check"} size={14} />
      <span style={{ flex: 1 }}>{toast.msg}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action.onClick();
            onDismiss();
          }}
          style={{
            background: "transparent",
            border: "1px solid currentColor",
            borderRadius: "var(--r)",
            color: "inherit",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 2 }}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

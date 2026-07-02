export default function ResetPasswordPanel({
  error,
  password,
  saving,
  onCancel,
  onChangePassword,
  onReset,
}) {
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
      {error && (
        <div style={{ padding: "4px 8px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", fontSize: 11, color: "var(--red-text)", marginBottom: 6 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="fi"
          type="password"
          value={password}
          onChange={(e) => onChangePassword(e.target.value)}
          placeholder="New temporary password"
          style={{ flex: 1, fontSize: 12 }}
        />
        <button type="button" className="btn btn-p" style={{ fontSize: 11, padding: "5px 10px" }} disabled={saving} onClick={onReset}>
          {saving ? "Saving..." : "Reset"}
        </button>
        <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "5px 10px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

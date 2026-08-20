import ModalShell from "../../ui/ModalShell.jsx";
import { formatCost } from "../../../utils/helpers.js";
import { formatDate } from "../../../utils/formatting.js";

function periodLabel(item) {
  if (item.sourceType === "original_included_support") return "Included support";
  return item.isCurrent ? "Current maintenance contract" : "Maintenance contract";
}

export default function CoverageHistoryModal({ history, userSettings, onClose, onNavigate }) {
  return (
    <ModalShell title="Coverage History" titleId="coverage-history-title" onClose={onClose}>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.5, margin: "0 0 16px" }}>
          Coverage periods are preserved here when a later maintenance record becomes active.
        </p>
        {history.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 12 }}>No coverage history has been recorded.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {history.map((item) => (
              <div key={`${item.id}-${item.sourceType}`} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12 }}>{periodLabel(item)}</strong>
                  <span style={{ color: "var(--text-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                    {item.isCurrent ? "ACTIVE" : "RECORDED"}
                  </span>
                </div>
                <div style={{ color: "var(--text-2)", fontSize: 11, marginTop: 7, fontFamily: "var(--font-mono)" }}>
                  {item.startDate ? formatDate(item.startDate, userSettings) : "—"} → {item.endDate ? formatDate(item.endDate, userSettings) : "—"}
                </div>
                <div style={{ color: "var(--text-2)", fontSize: 11, marginTop: 7 }}>
                  Cost: {item.cost ? formatCost(item.cost, item.currency || "EUR", userSettings?.numberFormatLocale ?? "en-US") : "—"}
                </div>
                {item.licenseRef && (
                  <button
                    type="button"
                    className="btn btn-g btn-sm"
                    style={{ marginTop: 9 }}
                    onClick={() => onNavigate?.(item.maintenanceLicenseId)}
                  >
                    Open {item.licenseRef}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

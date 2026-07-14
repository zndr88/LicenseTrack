import { DEFAULT_STATUS_FILTERS } from "../../../constants/licenseData.js";

const CHIPS = [
  { key: "active",          label: "Active",     color: "var(--green)"       },
  { key: "upcoming",        label: "Upcoming",   color: "var(--steel-text)"  },
  { key: "expiring",        label: "Expiring",   color: "var(--orange)"      },
  { key: "expired",         label: "Expired",    color: "var(--red)"         },
  { key: "pending_renewal", label: "Pending",    color: "var(--purple-text)" },
  { key: "renewed",         label: "Renewed",    color: "var(--text-3)"      },
  { key: "retired",         label: "Retired",    color: "var(--text-3)"      },
  { key: "legacy",          label: "Legacy",     color: "var(--text-3)"      },
  { key: "_sep" },
  { key: "complete",        label: "Complete",   color: "var(--green)"       },
  { key: "incomplete",      label: "Incomplete", color: "var(--orange)"      },
];

export default function LicenseStatusFilter({ statusFilters, setStatusFilters, setCurrentPage }) {
  const toggle = (key) => {
    setStatusFilters((prev) => {
      const isActive = prev.includes(key);
      if (isActive) return prev.filter((k) => k !== key);
      const opposite = key === "complete" ? "incomplete" : key === "incomplete" ? "complete" : null;
      let next = [...prev, key];
      if (opposite) next = next.filter((k) => k !== opposite);
      return next;
    });
    setCurrentPage(1);
  };

  return (
    <div className="lp-status-bar">
      <div className="lp-row2-left">
        {CHIPS.map((s) => {
          if (s.key === "_sep") return <span key="_sep" className="lp-chip-sep" />;
          const active = statusFilters.includes(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              style={{
                padding: "3px 8px", borderRadius: 12, border: "1px solid",
                borderColor: active ? s.color : "var(--border)",
                background: active ? `${s.color}18` : "none",
                color: active ? s.color : "var(--text-3)",
                fontSize: 10, fontWeight: 600, fontFamily: "var(--sans)",
                cursor: "pointer", transition: "all .15s",
              }}
            >
              {s.label}
            </button>
          );
        })}
        {statusFilters.length > 0 && (
          <button
            onClick={() => { setStatusFilters(DEFAULT_STATUS_FILTERS); setCurrentPage(1); }}
            className="lp-chip-remove"
            aria-label="Clear filters"
          >
            ✕
          </button>
        )}
      </div>
      <div className="lp-row2-right" />
    </div>
  );
}

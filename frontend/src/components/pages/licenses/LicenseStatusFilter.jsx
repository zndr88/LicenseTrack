import { DEFAULT_STATUS_FILTERS } from "../../../constants/licenseData.js";

// `tone` picks the chip colour through the lp-chip-<tone> classes in licenses.css.
const CHIPS = [
  { key: "active",          label: "Active",              tone: "green"  },
  { key: "upcoming",        label: "Upcoming",            tone: "steel"  },
  { key: "expiring",        label: "Expiring",            tone: "orange" },
  { key: "expired",         label: "Expired",             tone: "red"    },
  { key: "pending_renewal", label: "Renewal in progress", tone: "purple" },
  { key: "renewed",         label: "Renewed",             tone: "muted"  },
  { key: "retired",         label: "Retired",             tone: "muted"  },
  { key: "legacy",          label: "Legacy",              tone: "muted"  },
  { key: "_sep" },
  { key: "complete",        label: "Complete",            tone: "green"  },
  { key: "incomplete",      label: "Incomplete",          tone: "orange" },
  { key: "_sep_support" },
  { key: "support_due",     label: "Maintenance due",     tone: "orange" },
];

function isDefaultSelection(statusFilters) {
  return statusFilters.length === DEFAULT_STATUS_FILTERS.length
    && DEFAULT_STATUS_FILTERS.every((key) => statusFilters.includes(key));
}

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
          if (s.key.startsWith("_sep")) return <span key={s.key} className="lp-chip-sep" />;
          const active = statusFilters.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              className={`lp-chip lp-chip-${s.tone}`}
              aria-pressed={active}
              onClick={() => toggle(s.key)}
            >
              {s.label}
            </button>
          );
        })}
        {!isDefaultSelection(statusFilters) && (
          <button
            type="button"
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

import { useState, useEffect, useCallback } from "react";
import Icon from "../ui/Icon.jsx";
import { getAuditLog, exportAuditLog } from "../../api/auditLog.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatTimestamp(ts) {
  if (!ts) return "";
  // The backend returns naive UTC datetimes — append "Z" so JS parses as UTC.
  const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Map action category → filter value sent to API
const ACTION_CATEGORIES = [
  { label: "All", value: "" },
  { label: "Auth", value: "auth" },
  { label: "Licenses", value: "license" },
  { label: "Users", value: "user" },
  { label: "Settings", value: "settings" },
  { label: "Procurement", value: "sourcing,po" },
  { label: "Documents", value: "document" },
  { label: "Contracts", value: "contract" },
  { label: "System", value: "system" },
];

// Badge colour by action prefix
function actionBadgeStyle(action) {
  if (!action) return {};
  if (action.startsWith("license."))  return { background: "var(--green-dim)",  color: "var(--green-text)"  };
  if (action.startsWith("user."))     return { background: "var(--purple-dim)", color: "var(--purple-text)" };
  if (action.startsWith("settings.")) return { background: "var(--orange-dim)", color: "var(--orange-text)" };
  if (action.startsWith("contract.")) return { background: "var(--steel-dim)",  color: "var(--steel-text)"  };
  if (action.startsWith("auth.")     ||
      action.startsWith("sourcing.") ||
      action.startsWith("po.")       ||
      action.startsWith("document.") ||
      action.startsWith("system."))   return { background: "var(--steel-dim)",  color: "var(--steel-text)"  };
  return { background: "var(--bg-2)", color: "var(--text-2)" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [filterDateFrom, setFilterDateFrom] = useState(daysAgoStr(7));
  const [filterDateTo, setFilterDateTo] = useState(todayStr());
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const hasFilters =
    filterSearch !== "" ||
    filterCategory !== "" ||
    filterDateFrom !== daysAgoStr(7) ||
    filterDateTo !== todayStr();

  // Derive the `action` param from the selected category.
  // For "Procurement" we send two separate requests or handle server-side with one partial match.
  // The backend does partial ilike match, so "sourcing" also matches "sourcing.*" and "po" matches "po.*".
  // For "Procurement" we need to pick one — use a comma-separated value and split it into two calls.
  // Simpler: pass the raw category value as two separate filter calls, OR just use one of them.
  // Cleanest: use "sourcing" OR "po" but the API only accepts one action filter.
  // We'll handle this by fetching twice for Procurement and merging — but that's complex.
  // Alternative: pass "sourcing" and rely on `po` being a different prefix; or just use "" and local filter.
  // For now: if the selected category value contains a comma, we pass the first part to the API
  // and filter locally. This is acceptable given typical log volumes.

  const buildParams = useCallback(
    (overridePage) => {
      const categoryValue = filterCategory.includes(",")
        ? filterCategory.split(",")[0]
        : filterCategory;
      return {
        page: overridePage ?? page,
        pageSize: PAGE_SIZE,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        search: filterSearch || undefined,
        action: categoryValue || undefined,
      };
    },
    [page, filterDateFrom, filterDateTo, filterSearch, filterCategory]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await getAuditLog(buildParams());
    setLoading(false);
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);

    // Secondary local filter for "Procurement" (both sourcing.* and po.*)
    let results = data?.results ?? [];
    if (filterCategory === "sourcing,po") {
      results = results.filter(
        (e) => e.action?.startsWith("sourcing.") || e.action?.startsWith("po.")
      );
    }
    setEntries(results);
    setTotal(data?.total ?? 0);
  }, [buildParams, filterCategory]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filterDateFrom, filterDateTo, filterSearch, filterCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function clearFilters() {
    setFilterDateFrom(daysAgoStr(7));
    setFilterDateTo(todayStr());
    setFilterSearch("");
    setFilterCategory("");
    setPage(1);
  }

  async function handleExport() {
    const categoryValue = filterCategory.includes(",")
      ? ""
      : filterCategory;
    const { error } = await exportAuditLog({
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      search: filterSearch || undefined,
      action: categoryValue || undefined,
    });
    if (error) {
      setLoadError(error);
    }
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div style={{ marginTop: 16 }}>

      {/* ── Filter bar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <input
          className="fi"
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          style={{ width: 140 }}
          title="From date"
        />
        <span style={{ color: "var(--text-3)", fontSize: 13 }}>–</span>
        <input
          className="fi"
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          style={{ width: 140 }}
          title="To date"
        />
        <input
          className="fi"
          type="text"
          placeholder="Search actor, target, detail…"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          style={{ flex: "1 1 200px", minWidth: 160 }}
        />
        <select
          className="fi"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{ width: 140 }}
        >
          {ACTION_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button className="btn btn-g" onClick={handleExport} title="Export to CSV">
          <Icon name="download" size={14} /> Export CSV
        </button>
        {hasFilters && (
          <button
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, padding: "0 4px" }}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Table ── */}
      {loadError ? (
        <div style={{ padding: "10px 12px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", fontSize: 13, color: "var(--red-text)", marginBottom: 12 }}>
          {loadError}
        </div>
      ) : loading ? (
        <p style={{ color: "var(--text-3)", fontSize: 13, padding: "24px 0" }}>Loading…</p>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>No audit events found</p>
          {hasFilters && (
            <p style={{ color: "var(--text-3)", fontSize: 13 }}>Try adjusting your filters</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-3)", textAlign: "left" }}>
                <th scope="col" style={{ padding: "6px 10px", fontWeight: 600 }}>Timestamp</th>
                <th scope="col" style={{ padding: "6px 10px", fontWeight: 600 }}>Actor</th>
                <th scope="col" style={{ padding: "6px 10px", fontWeight: 600 }}>Action</th>
                <th scope="col" style={{ padding: "6px 10px", fontWeight: 600 }}>Target</th>
                <th scope="col" style={{ padding: "6px 10px", fontWeight: 600 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  style={{ borderBottom: "1px solid var(--border)", verticalAlign: "top" }}
                >
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap", color: "var(--text-2)" }}>
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                    {entry.actorEmail || "system"}
                  </td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      ...actionBadgeStyle(entry.action),
                    }}>
                      {entry.action}
                    </span>
                  </td>
                  <td style={{ padding: "7px 10px" }}>
                    {entry.targetType && (
                      <span style={{ color: "var(--text-3)", fontSize: 11, marginRight: 4 }}>
                        {entry.targetType} ·
                      </span>
                    )}
                    {entry.targetLabel || entry.targetId || ""}
                  </td>
                  <td style={{ padding: "7px 10px", maxWidth: 280 }}>
                    {entry.detail ? (
                      <span title={entry.detail} style={{ cursor: entry.detail.length > 80 ? "help" : "default" }}>
                        {entry.detail.length > 80
                          ? entry.detail.slice(0, 80) + "…"
                          : entry.detail}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, fontSize: 13, color: "var(--text-2)" }}>
          <button
            className="btn btn-g"
            onClick={() => setPage((p) => p - 1)}
            disabled={page <= 1}
            style={{ padding: "4px 12px" }}
          >
            Previous
          </button>
          <span>
            {entries.length === 0
              ? "No results"
              : `Showing ${start}–${end} of ${total} entries`}
          </span>
          <button
            className="btn btn-g"
            onClick={() => setPage((p) => p + 1)}
            disabled={page * PAGE_SIZE >= total}
            style={{ padding: "4px 12px" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import Icon from "../ui/Icon.jsx";
import { getAuditLog, exportAuditLog } from "../../api/auditLog.js";

// Helpers

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
  // The backend returns naive UTC datetimes - append "Z" so JS parses as UTC.
  const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Map action category -> filter value sent to API
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

// Badge class by action prefix
function actionBadgeClass(action) {
  if (!action) return "audit-badge-default";
  if (action.startsWith("license.")) return "audit-badge-license";
  if (action.startsWith("user.")) return "audit-badge-user";
  if (action.startsWith("settings.")) return "audit-badge-settings";
  if (action.startsWith("contract.")) return "audit-badge-system";
  if (action.startsWith("auth.")     ||
      action.startsWith("sourcing.") ||
      action.startsWith("po.")       ||
      action.startsWith("document.") ||
      action.startsWith("system.")) return "audit-badge-system";
  return "audit-badge-default";
}

// Component

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
  // For "Procurement" we need to pick one - use a comma-separated value and split it into two calls.
  // Simpler: pass the raw category value as two separate filter calls, OR just use one of them.
  // Cleanest: use "sourcing" OR "po" but the API only accepts one action filter.
  // We'll handle this by fetching twice for Procurement and merging - but that's complex.
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
    <div className="audit-log">

      {/* Filter bar */}
      <div className="audit-filters">
        <input
          className="fi audit-date-input"
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          title="From date"
        />
        <span className="audit-date-separator">-</span>
        <input
          className="fi audit-date-input"
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          title="To date"
        />
        <input
          className="fi audit-search-input"
          type="text"
          placeholder="Search actor, target, detail..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
        />
        <select
          className="fi audit-category-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
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
            className="audit-clear-button"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loadError ? (
        <div className="audit-error-box">
          {loadError}
        </div>
      ) : loading ? (
        <p className="audit-loading">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="audit-empty">
          <p className="audit-empty-title">No audit events found</p>
          {hasFilters && (
            <p className="audit-empty-hint">Try adjusting your filters</p>
          )}
        </div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="audit-timestamp">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className="audit-nowrap">
                    {entry.actorEmail || "system"}
                  </td>
                  <td className="audit-nowrap">
                    <span className={`audit-badge ${actionBadgeClass(entry.action)}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td>
                    {entry.targetType && (
                      <span className="audit-target-type">
                        {entry.targetType} -
                      </span>
                    )}
                    {entry.targetLabel || entry.targetId || ""}
                  </td>
                  <td className="audit-detail">
                    {entry.detail ? (
                      <span
                        className={entry.detail.length > 80 ? "audit-detail-truncated" : undefined}
                        title={entry.detail}
                      >
                        {entry.detail.length > 80
                          ? entry.detail.slice(0, 80) + "..."
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

      {/* Pagination */}
      {total > 0 && (
        <div className="audit-pagination">
          <button
            className="btn btn-g audit-page-button"
            onClick={() => setPage((p) => p - 1)}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span>
            {entries.length === 0
              ? "No results"
              : `Showing ${start}-${end} of ${total} entries`}
          </span>
          <button
            className="btn btn-g audit-page-button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page * PAGE_SIZE >= total}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

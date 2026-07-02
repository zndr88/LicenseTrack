import { formatNumber } from "../../../utils/formatting.js";

export default function LicenseTableFooter({
  useVirtual,
  filtered,
  hasColumnFilters,
  currentPage,
  pageSize,
  setPageSize,
  setCurrentPage,
  totalPages,
  userSettings,
}) {
  if (useVirtual) {
    return (
      <div style={{
        padding: "8px 16px",
        fontSize: 11,
        color: "var(--text-3)",
        borderTop: "1px solid var(--border)",
        fontFamily: "var(--font-mono)",
      }}>
        {formatNumber(filtered.length, userSettings)} records - scroll to browse
        {hasColumnFilters && " / column filters active"}
      </div>
    );
  }

  return (
    <div className="lp-pagination">
      <div className="lp-pagesize">
        <span>Showing {formatNumber(Math.min((currentPage - 1) * pageSize + 1, filtered.length), userSettings)}–{formatNumber(Math.min(currentPage * pageSize, filtered.length), userSettings)} of {formatNumber(filtered.length, userSettings)}</span>
        <span style={{ color: "var(--border-lt)" }}>|</span>
        <span>Per page:</span>
        {[20, 50, 100].map((size) => (
          <button
            key={size}
            onClick={() => { setPageSize(size); setCurrentPage(1); }}
            style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid", borderColor: pageSize === size ? "var(--accent)" : "var(--border)", background: pageSize === size ? "var(--accent-m)" : "none", color: pageSize === size ? "var(--accent)" : "var(--text-3)", fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)", cursor: "pointer" }}
          >
            {size}
          </button>
        ))}
      </div>
      <div className="lp-pagnav">
        <button
          className="lp-page-btn"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={currentPage === 1}
          style={{ color: currentPage === 1 ? "var(--text-3)" : "var(--text-2)", cursor: currentPage === 1 ? "default" : "pointer", opacity: currentPage === 1 ? 0.4 : 1 }}
        >
          {"<- Prev"}
        </button>
        <span className="lp-pagecnt">{currentPage} / {totalPages}</span>
        <button
          className="lp-page-btn"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={currentPage === totalPages}
          style={{ color: currentPage === totalPages ? "var(--text-3)" : "var(--text-2)", cursor: currentPage === totalPages ? "default" : "pointer", opacity: currentPage === totalPages ? 0.4 : 1 }}
        >
          {"Next ->"}
        </button>
      </div>
    </div>
  );
}

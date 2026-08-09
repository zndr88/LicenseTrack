import Icon from "../ui/Icon.jsx";
import { formatNumber } from "../../utils/formatting.js";

export const PROCUREMENT_PAGE_SIZES = [20, 50, 100];

export function getPaginationDetails(totalItems, currentPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);
  return { end, safePage, start, totalPages };
}

export function paginateRows(rows, currentPage, pageSize) {
  const { safePage } = getPaginationDetails(rows.length, currentPage, pageSize);
  const startIndex = (safePage - 1) * pageSize;
  return rows.slice(startIndex, startIndex + pageSize);
}

export default function ProcurementTablePagination({
  currentPage,
  itemLabel = "records",
  pageSize,
  setCurrentPage,
  setPageSize,
  totalItems,
  userSettings,
}) {
  if (totalItems === 0) return null;

  const { end, safePage, start, totalPages } = getPaginationDetails(totalItems, currentPage, pageSize);

  return (
    <div className="procurement-pagination">
      <div className="procurement-pagesize">
        <span>
          Showing {formatNumber(start, userSettings)}-{formatNumber(end, userSettings)} of{" "}
          {formatNumber(totalItems, userSettings)} {itemLabel}
        </span>
        <span className="procurement-pagination-separator">|</span>
        <span>Per page:</span>
        {PROCUREMENT_PAGE_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={`procurement-page-size${pageSize === size ? " active" : ""}`}
            onClick={() => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          >
            {size}
          </button>
        ))}
      </div>
      <div className="procurement-pagenav">
        <button
          type="button"
          className="procurement-page-btn"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={safePage === 1}
        >
          <Icon name="chevron-left" size={13} />
          Prev
        </button>
        <span className="procurement-page-count">
          {formatNumber(safePage, userSettings)} / {formatNumber(totalPages, userSettings)}
        </span>
        <button
          type="button"
          className="procurement-page-btn"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={safePage === totalPages}
        >
          Next
          <Icon name="chevron-right" size={13} />
        </button>
      </div>
    </div>
  );
}

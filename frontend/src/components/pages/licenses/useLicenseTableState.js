import { useCallback, useEffect, useState } from "react";
import { DEFAULT_STATUS_FILTERS } from "../../../constants/licenseData.js";
import {
  loadDismissedAttentionIds,
  saveDismissedAttentionIds,
} from "../../../utils/licenseAttentionSession.js";
import { sanitizeGroupBy } from "./registryGrouping.js";

export function useLicenseTableState() {
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState(DEFAULT_STATUS_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [hoveredCol, setHoveredCol] = useState(null);
  const [dismissedAttentionIds, setDismissedAttentionIds] = useState(loadDismissedAttentionIds);

  const [groupBy, setGroupByState] = useState([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => new Set());
  const [groupStripOpen, setGroupStripOpen] = useState(false);

  const setGroupBy = useCallback((next) => {
    setGroupByState(sanitizeGroupBy(next));
    setExpandedGroupIds(new Set());
  }, []);

  const toggleGroup = useCallback((id) => {
    setExpandedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    saveDismissedAttentionIds(dismissedAttentionIds);
  }, [dismissedAttentionIds]);

  const hasColumnFilters = Object.values(columnFilters).some((v) =>
    Array.isArray(v) ? v.length > 0 : (v && v.trim())
  );

  function handleSortCol(colKey) {
    if (sortCol !== colKey) {
      setSortCol(colKey);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortCol(null);
      setSortDir("asc");
    }
  }

  return {
    search, setSearch,
    statusFilters, setStatusFilters,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    sortCol, setSortCol, sortDir, setSortDir, handleSortCol,
    selectedIds, setSelectedIds,
    showBulkDeleteConfirm, setShowBulkDeleteConfirm,
    filterRowOpen, setFilterRowOpen,
    columnFilters, setColumnFilters, hasColumnFilters,
    hoveredCol, setHoveredCol,
    dismissedAttentionIds, setDismissedAttentionIds,
    groupBy, setGroupBy,
    expandedGroupIds, setExpandedGroupIds, toggleGroup,
    groupStripOpen, setGroupStripOpen,
  };
}

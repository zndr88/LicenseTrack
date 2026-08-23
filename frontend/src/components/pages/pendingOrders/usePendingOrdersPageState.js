import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCost } from "../../../utils/helpers.js";
import { pendingOrderLabel } from "../../../utils/procurementLabels.js";
import {
  compareProcurementTotals,
  procurementTotalsByCurrency,
} from "../../../utils/procurementTotals.js";

export function formatPoTotal(po, locale) {
  if (!po.items?.length) return "-";

  const parts = Object.entries(procurementTotalsByCurrency(po.items)).sort(([a], [b]) => a.localeCompare(b));
  if (!parts.length) return "-";
  return parts.map(([currency, amount]) => formatCost(amount, currency, locale)).join(" + ");
}

export function filterAndSortPendingOrders(pendingOrders, search, sortCol, sortDir) {
  let orders = pendingOrders;

  if (search.trim()) {
    const query = search.trim().toLowerCase();
    orders = orders.filter((po) =>
      (po.poNumber ?? "").toLowerCase().includes(query) ||
      pendingOrderLabel(po).toLowerCase().includes(query) ||
      (po.procurementReference ?? "").toLowerCase().includes(query) ||
      (po.supplier ?? "").toLowerCase().includes(query) ||
      (po.items ?? []).some((item) =>
        (item.publisherName ?? "").toLowerCase().includes(query) ||
        (item.softwareDescription ?? "").toLowerCase().includes(query)
      )
    );
  }

  if (!sortCol) return orders;

  return [...orders].sort((a, b) => {
    let aVal;
    let bVal;

    switch (sortCol) {
      case "poNumber":
        aVal = pendingOrderLabel(a);
        bVal = pendingOrderLabel(b);
        break;
      case "supplier":
        aVal = a.supplier ?? "";
        bVal = b.supplier ?? "";
        break;
      case "itemCount":
        aVal = a.items?.length ?? 0;
        bVal = b.items?.length ?? 0;
        break;
      case "totalValue": {
        return compareProcurementTotals(a.items, b.items, sortDir);
      }
      case "status":
        aVal = a.status ?? "";
        bVal = b.status ?? "";
        break;
      case "created":
        aVal = a.createdAt ?? "";
        bVal = b.createdAt ?? "";
        break;
      default:
        return 0;
    }

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    const comparison = typeof aVal === "number"
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? comparison : -comparison;
  });
}

export function usePendingOrdersPageState({
  pendingOrders,
  highlightId,
  onClearHighlight,
}) {
  const [cancelPendingOrderId, setCancelPendingOrderId] = useState(null);
  const [expandedPendingOrderId, setExpandedPendingOrderId] = useState(null);
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    if (!highlightId) return;
    if (!pendingOrders.some((po) => po.id === highlightId)) return;

    setExpandedPendingOrderId(highlightId);
    const element = document.querySelector(`[data-po-row="${highlightId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    setHighlightedRowId(highlightId);
    const timeoutId = setTimeout(() => {
      setHighlightedRowId(null);
      onClearHighlight?.();
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [highlightId, pendingOrders, onClearHighlight]);

  const handleSort = useCallback((column) => {
    if (sortCol !== column) {
      setSortCol(column);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortCol(null);
    setSortDir("asc");
  }, [sortCol, sortDir]);

  const displayed = useMemo(() => {
    return filterAndSortPendingOrders(pendingOrders, search, sortCol, sortDir);
  }, [pendingOrders, search, sortCol, sortDir]);

  return {
    cancelPendingOrderId,
    displayed,
    expandedPendingOrderId,
    handleSort,
    highlightedRowId,
    search,
    setCancelPendingOrderId,
    setExpandedPendingOrderId,
    setSearch,
    sortCol,
    sortDir,
  };
}

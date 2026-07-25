import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCost } from "../../../utils/helpers.js";

export function formatPoTotal(po, locale) {
  if (!po.items?.length) return "-";

  const totals = {};
  for (const item of po.items) {
    if (item.estimatedTotalPrice != null) {
      const value = parseFloat(item.estimatedTotalPrice);
      if (!Number.isNaN(value)) {
        totals[item.currency] = (totals[item.currency] ?? 0) + value;
      }
    }
  }

  const parts = Object.entries(totals);
  if (!parts.length) return "-";
  return parts.map(([currency, amount]) => formatCost(amount, currency, locale)).join(" + ");
}

export function filterAndSortPendingOrders(pendingOrders, search, sortCol, sortDir) {
  let orders = pendingOrders;

  if (search.trim()) {
    const query = search.trim().toLowerCase();
    orders = orders.filter((po) =>
      (po.poNumber ?? "").toLowerCase().includes(query) ||
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
        aVal = a.poNumber ?? "";
        bVal = b.poNumber ?? "";
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
        const poSum = (po) => (po.items ?? []).reduce((sum, item) => {
          const value = parseFloat(item.estimatedTotalPrice);
          return sum + (Number.isNaN(value) ? 0 : value);
        }, 0);
        aVal = poSum(a);
        bVal = poSum(b);
        break;
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

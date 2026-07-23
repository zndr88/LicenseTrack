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
  licenses,
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

  const buildPrefillFromOrder = useCallback((po) => {
    const base = {
      poNumber: po.poNumber || "",
      supplier: po.supplier || "",
      notes: po.notes || "",
      currency: "EUR",
    };

    const renewalItem = po.items?.find((item) => item.isRenewal && item.renewalForLicenseId);
    if (renewalItem) {
      const license = licenses.find((entry) => entry.id === renewalItem.renewalForLicenseId);
      if (license) {
        return {
          ...base,
          publisherName: license.publisherName || "",
          softwareDescription: license.softwareDescription || "",
          quantity: renewalItem.quantity || "",
          currency: license.currency || "EUR",
          unitPrice: license.unitPrice || "",
          totalPoPrice: license.totalPoPrice || "",
          contractNumber: license.contractNumber || "",
          invoiceNumber: "",
          contactEmail: license.contactEmail || "",
          supplier: license.supplier || base.supplier,
          costCentre: license.costCentre || "",
          licenseType: license.licenseType || "subscription",
          licenseMetric: license.licenseMetric || "per_user",
          portalUrl: license.portalUrl || "",
          skuCode: license.skuCode || "",
          budgetOwnerEmail: license.budgetOwnerEmail || "",
          notes: license.notes || "",
        };
      }
    }

    if (po.items?.length === 1) {
      const item = po.items[0];
      return {
        ...base,
        publisherName: item.publisherName || "",
        softwareDescription: item.softwareDescription || "",
        quantity: item.quantity || "",
        currency: item.currency || "EUR",
        unitPrice: item.estimatedUnitPrice || "",
        totalPoPrice: item.estimatedTotalPrice || "",
        supplier: item.supplier || base.supplier || "",
        contactEmail: item.contactEmail || "",
        licenseType: item.licenseType || "subscription",
        licenseMetric: item.licenseMetric || "per_user",
        maintenanceCoverage: item.maintenanceCoverage || "unknown",
        maintenanceStartDate: item.maintenanceStartDate || "",
        maintenanceEndDate: item.maintenanceEndDate || "",
        maintenancePricingBasis: item.maintenancePricingBasis || "flat",
        maintenanceQuantity: item.maintenanceQuantity || "",
        maintenanceUnitPrice: item.maintenanceUnitPrice || "",
        maintenanceCost: item.maintenanceCost || "",
      };
    }

    return base;
  }, [licenses]);

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
    buildPrefillFromOrder,
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

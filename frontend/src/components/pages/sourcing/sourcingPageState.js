import { compareProcurementTotals } from "../../../utils/procurementTotals.js";

export function sortSourcingRequests(requests, sortCol, sortDir) {
  if (!sortCol) return requests;

  const requestValue = (request, col) => {
    switch (col) {
      case "supplier": return request.supplier ?? "";
      case "itemCount": return request.items?.length ?? 0;
      case "created": return request.createdAt ?? "";
      default: return "";
    }
  };

  return [...requests].sort((a, b) => {
    if (sortCol === "total") {
      return compareProcurementTotals(a.items, b.items, sortDir);
    }

    const aVal = requestValue(a, sortCol);
    const bVal = requestValue(b, sortCol);

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    const comparison = typeof aVal === "number"
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? comparison : -comparison;
  });
}

import { compareProcurementTotals } from "../../../utils/procurementTotals.js";

export function sourcingRequestPublishers(request) {
  return [...new Set((request.items ?? [])
    .map((item) => item.publisherName?.trim())
    .filter(Boolean))].join(", ");
}

export function sortSourcingRequests(requests, sortCol, sortDir) {
  if (!sortCol) return requests;

  const requestValue = (request, col) => {
    switch (col) {
      case "supplier": return request.supplier ?? "";
      case "publisher": return sourcingRequestPublishers(request);
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

    const comparison = typeof aVal === "number"
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? comparison : -comparison;
  });
}

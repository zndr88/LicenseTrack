import { isBundledIncludedSupport } from "./maintenanceCoverage.js";

export function procurementLineTotal(item) {
  const acquisition = item?.estimatedTotalPrice;
  const support = item?.maintenanceCoverage === "included" &&
    !isBundledIncludedSupport(item?.licenseType, item?.maintenanceCoverage)
    ? item?.maintenanceCost
    : null;
  const hasAcquisition = acquisition !== null && acquisition !== undefined && acquisition !== "";
  const hasSupport = support !== null && support !== undefined && support !== "";
  if (!hasAcquisition && !hasSupport) return null;

  const acquisitionValue = hasAcquisition ? Number(acquisition) : 0;
  const supportValue = hasSupport ? Number(support) : 0;
  if (Number.isNaN(acquisitionValue) && Number.isNaN(supportValue)) return null;
  return (Number.isNaN(acquisitionValue) ? 0 : acquisitionValue) +
    (Number.isNaN(supportValue) ? 0 : supportValue);
}

export function procurementTotalsByCurrency(items = []) {
  const totals = {};
  for (const item of items) {
    const value = procurementLineTotal(item);
    if (value === null) continue;
    const currency = item?.currency || "EUR";
    totals[currency] = (totals[currency] ?? 0) + value;
  }
  return totals;
}

export function compareProcurementTotals(leftItems = [], rightItems = [], direction = "asc") {
  const left = Object.entries(procurementTotalsByCurrency(leftItems)).sort(([a], [b]) => a.localeCompare(b));
  const right = Object.entries(procurementTotalsByCurrency(rightItems)).sort(([a], [b]) => a.localeCompare(b));
  if (!left.length || !right.length) {
    if (left.length === right.length) return 0;
    return left.length ? -1 : 1;
  }

  const leftCurrencies = left.map(([currency]) => currency).join("+");
  const rightCurrencies = right.map(([currency]) => currency).join("+");
  const currencyComparison = leftCurrencies.localeCompare(rightCurrencies);
  if (currencyComparison !== 0) return direction === "asc" ? currencyComparison : -currencyComparison;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index]?.[1] ?? 0) - (right[index]?.[1] ?? 0);
    if (difference !== 0) return direction === "asc" ? difference : -difference;
  }
  return 0;
}

import { LICENSE_TYPES, LICENSE_METRICS } from "../constants/licenseData.js";

// Filter

/**
 * @param {object[]} licenses
 * @param {{ includeRetired: boolean, dateRange: "all"|"thisYear"|"last12"|{from:string,to:string}, costCentres: string[] }} opts
 * @returns {object[]}
 */
export function filterLicenses(licenses, { includeRetired = false, dateRange = "all", costCentres = [] } = {}) {
  let result = licenses;

  if (!includeRetired) {
    result = result.filter((l) => !l.isRetired && !l.retired && l.lifecycleStatus !== "legacy");
  }

  if (costCentres.length > 0) {
    result = result.filter((l) => costCentres.includes(l.costCentre ?? ""));
  }

  const range = resolveReportDateRange(dateRange);
  if (range) {
    result = result.filter((l) => licenseOverlapsReportRange(l, range));
  }

  return result;
}

// Spend helpers

function parsePrice(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(String(val).replace(",", "."));
  return isNaN(n) ? null : n;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECURRING_TYPES = ["subscription", "saas", "maintenance"];
const INCLUDED_SUPPORT_PARENT_TYPES = ["freeware", "perpetual", "oem"];

function parseReportDate(value) {
  if (typeof value !== "string") return new Date(value);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(value);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function calendarDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY;
}

function endOfReportDate(value) {
  const date = parseReportDate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function resolveReportDateRange(dateRange) {
  if (!dateRange || dateRange === "all") return null;
  const now = new Date();
  if (dateRange === "thisYear") {
    return {
      from: new Date(now.getFullYear(), 0, 1),
      to: endOfReportDate(`${now.getFullYear()}-12-31`),
    };
  }
  if (dateRange === "last12") {
    const from = new Date(now);
    from.setMonth(from.getMonth() - 12);
    from.setHours(0, 0, 0, 0);
    return { from, to: endOfReportDate(now) };
  }
  if (typeof dateRange === "object" && dateRange.from && dateRange.to) {
    return {
      from: parseReportDate(dateRange.from),
      to: endOfReportDate(dateRange.to),
    };
  }
  return null;
}

function getTermBounds(startValue, endValue) {
  if (!startValue || !endValue) return null;
  const start = parseReportDate(startValue);
  const end = parseReportDate(endValue);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || calendarDayNumber(end) < calendarDayNumber(start)) {
    return null;
  }
  return { from: start, to: end };
}

function inclusiveDayCount(from, to) {
  return calendarDayNumber(to) - calendarDayNumber(from) + 1;
}

function overlapDayCount(a, b) {
  const fromDay = Math.max(calendarDayNumber(a.from), calendarDayNumber(b.from));
  const toDay = Math.min(calendarDayNumber(a.to), calendarDayNumber(b.to));
  return Math.max(toDay - fromDay + 1, 0);
}

function licenseOverlapsReportRange(license, range) {
  const start = license.startDate ? parseReportDate(license.startDate) : null;
  const end = license.endDate ? parseReportDate(license.endDate) : null;
  if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
    return overlapDayCount({ from: start, to: end }, range) > 0;
  }
  if (start && !isNaN(start.getTime())) {
    return calendarDayNumber(start) <= calendarDayNumber(range.to);
  }
  if (end && !isNaN(end.getTime())) {
    return calendarDayNumber(end) >= calendarDayNumber(range.from);
  }
  return true;
}

function getLicenseLineValue(license) {
  if (license.licenseType === "freeware") {
    if (license.maintenanceCoverage === "included") {
      const maintenanceCost = parsePrice(license.maintenanceCost);
      if (maintenanceCost !== null && maintenanceCost > 0) {
        return { amount: maintenanceCost, source: "included_support" };
      }
    }
    return { amount: 0, source: "excluded" };
  }
  const quantity = parsePrice(license.quantity);
  const unitPrice = parsePrice(license.unitPrice);

  if (quantity !== null && unitPrice !== null) {
    return {
      amount: quantity * unitPrice,
      source: "line",
    };
  }

  return {
    amount: 0,
    source: "missing",
  };
}

function getCalculatedLicenseValue(license) {
  const lineValue = getLicenseLineValue(license);
  if (lineValue.source !== "missing") return lineValue;

  const totalPoPrice = parsePrice(license.totalPoPrice);
  if (totalPoPrice !== null) {
    return {
      amount: totalPoPrice,
      source: "po_fallback",
    };
  }

  return lineValue;
}

function isRecurringLicense(license) {
  return RECURRING_TYPES.includes(license.licenseType) ||
    (
      INCLUDED_SUPPORT_PARENT_TYPES.includes(license.licenseType) &&
      license.maintenanceCoverage === "included" &&
      parsePrice(license.maintenanceCost) > 0
    );
}

function getRecurringTermBounds(license) {
  if (
    INCLUDED_SUPPORT_PARENT_TYPES.includes(license.licenseType) &&
    license.maintenanceCoverage === "included"
  ) {
    return getTermBounds(license.maintenanceStartDate, license.maintenanceEndDate);
  }
  return getTermBounds(license.startDate, license.endDate);
}

function annualizeAmount(amount, term) {
  if (!term) return amount;
  const days = inclusiveDayCount(term.from, term.to);
  return days > 365 ? amount * 365 / days : amount;
}

function getRecurringLicenseValue(license) {
  if (
    INCLUDED_SUPPORT_PARENT_TYPES.includes(license.licenseType) &&
    license.maintenanceCoverage === "included"
  ) {
    const maintenanceCost = parsePrice(license.maintenanceCost);
    return maintenanceCost !== null
      ? { amount: maintenanceCost, source: "included_support" }
      : { amount: 0, source: "missing" };
  }
  return getCalculatedLicenseValue(license);
}

function getAnnualizedRecurringLicenseValue(license) {
  const cost = getRecurringLicenseValue(license);
  if (cost.source === "missing") return cost;
  return {
    ...cost,
    amount: roundMoney(annualizeAmount(cost.amount, getRecurringTermBounds(license))),
  };
}

function getAllocatedRecurringLicenseValue(license, range) {
  const cost = getRecurringLicenseValue(license);
  if (!range || cost.source === "missing") return cost;
  const term = getRecurringTermBounds(license);
  if (!term) return cost;
  const termDays = inclusiveDayCount(term.from, term.to);
  const overlapDays = overlapDayCount(term, range);
  if (termDays <= 0 || overlapDays <= 0) {
    return { ...cost, amount: 0 };
  }
  return {
    ...cost,
    amount: roundMoney(cost.amount * overlapDays / termDays),
  };
}

function getReportLicenseValue(license, range) {
  if (range && isRecurringLicense(license)) {
    return getAllocatedRecurringLicenseValue(license, range);
  }
  return getCalculatedLicenseValue(license);
}

function isCurrentMaintenanceCoverage(license) {
  const today = new Date();
  const starts = !license.maintenanceStartDate || new Date(license.maintenanceStartDate) <= today;
  const ends = !license.maintenanceEndDate || new Date(license.maintenanceEndDate) >= today;
  return starts && ends;
}

function isForecastActive(license) {
  if (license.isRetired || license.retired) return false;
  if (["renewed", "legacy"].includes(license.lifecycleStatus)) return false;
  if (license.renewedToId) return false;
  if (license.expirationStatus) {
    return ["active", "perpetual", "expiring"].includes(license.expirationStatus);
  }
  return true;
}

function getLifecycleBudget(licenses, range = null) {
  const byStatus = {
    active: {},
    expiring: {},
    expired: {},
  };

  for (const l of licenses) {
    const status = l.expirationStatus === "perpetual" ? "active" : l.expirationStatus;
    if (!Object.prototype.hasOwnProperty.call(byStatus, status)) continue;

    const cost = getReportLicenseValue(l, range);
    if (cost.source === "missing") continue;

    const cur = l.currency || "USD";
    byStatus[status][cur] = (byStatus[status][cur] ?? 0) + cost.amount;
  }

  return byStatus;
}

export function getLifecycleCounts(licenses) {
  const counts = {
    active: 0,
    upcoming: 0,
    expiring: 0,
    expired: 0,
  };

  for (const l of licenses) {
    if (l.expirationStatus === "active" || l.expirationStatus === "perpetual") {
      counts.active += 1;
    } else if (l.expirationStatus === "upcoming") {
      counts.upcoming += 1;
    } else if (l.expirationStatus === "expiring") {
      counts.expiring += 1;
    } else if (l.expirationStatus === "expired") {
      counts.expired += 1;
    }
  }

  return counts;
}

function addCurrencyAmount(target, currency, amount) {
  target[currency] = roundMoney((target[currency] ?? 0) + amount);
}

function getSpendComparison(licenses, range = null) {
  const licenseSpendByCurrency = {};
  const poSpendByCurrency = {};
  const poGroups = new Map();
  let unpricedCount = 0;
  let unkeyedCount = 0;

  for (const license of licenses) {
    if (license.licenseType === "freeware" && license.maintenanceCoverage !== "included") continue;

    const currency = license.currency || "USD";
    const poNumber = (license.poNumber ?? "").trim();
    const cost = range && isRecurringLicense(license)
      ? getAllocatedLineValue(license, range)
      : getLicenseLineValue(license);
    const hasPrice = cost.source !== "missing";

    if (hasPrice) {
      addCurrencyAmount(licenseSpendByCurrency, currency, cost.amount);
    } else {
      unpricedCount += 1;
    }

    if (!poNumber) {
      unkeyedCount += 1;
      if (hasPrice) addCurrencyAmount(poSpendByCurrency, currency, cost.amount);
      continue;
    }

    if (!poGroups.has(poNumber)) {
      poGroups.set(poNumber, {
        currency,
        lineTotal: 0,
        hasPricedLine: false,
        override: null,
      });
    }

    const group = poGroups.get(poNumber);
    if (hasPrice) {
      group.lineTotal = roundMoney(group.lineTotal + cost.amount);
      group.hasPricedLine = true;
    }
    const override = parsePrice(license.poTotalOverride);
    if (group.override === null && override !== null) group.override = override;
  }

  let overriddenPoCount = 0;
  for (const group of poGroups.values()) {
    if (group.override !== null) {
      addCurrencyAmount(poSpendByCurrency, group.currency, group.override);
      overriddenPoCount += 1;
    } else if (group.hasPricedLine) {
      addCurrencyAmount(poSpendByCurrency, group.currency, group.lineTotal);
    }
  }

  const spendDifferenceByCurrency = {};
  const currencies = new Set([
    ...Object.keys(licenseSpendByCurrency),
    ...Object.keys(poSpendByCurrency),
  ]);
  for (const currency of currencies) {
    spendDifferenceByCurrency[currency] = roundMoney(
      (poSpendByCurrency[currency] ?? 0) - (licenseSpendByCurrency[currency] ?? 0),
    );
  }

  return {
    licenseSpendByCurrency,
    poSpendByCurrency,
    spendDifferenceByCurrency,
    poCount: poGroups.size,
    overriddenPoCount,
    unkeyedCount,
    unpricedCount,
  };
}

function getAllocatedLineValue(license, range) {
  const cost = getLicenseLineValue(license);
  if (cost.source === "missing") return cost;
  const term = getRecurringTermBounds(license);
  if (!term) return cost;
  const termDays = inclusiveDayCount(term.from, term.to);
  const overlapDays = overlapDayCount(term, range);
  if (termDays <= 0 || overlapDays <= 0) return { ...cost, amount: 0 };
  return {
    ...cost,
    amount: roundMoney(cost.amount * overlapDays / termDays),
  };
}

function getRecurringRecords(licenses) {
  const records = [];

  for (const l of licenses) {
    if (!isForecastActive(l) || !isRecurringLicense(l)) continue;
    if (
      INCLUDED_SUPPORT_PARENT_TYPES.includes(l.licenseType) &&
      l.maintenanceCoverage === "included" &&
      !isCurrentMaintenanceCoverage(l)
    ) continue;

    const cost = getAnnualizedRecurringLicenseValue(l);
    records.push({
      id: l.id,
      publisher: l.publisherName || "Unknown",
      softwareDescription: l.softwareDescription || "",
      supplier: l.supplier || "",
      budgetOwnerEmail: l.budgetOwnerEmail || "",
      costCentre: l.costCentre || "",
      licenseType: l.licenseType,
      currency: l.currency || "USD",
      annualCost: cost.amount,
      costSource: cost.source,
    });
  }

  return records;
}

/**
 * @param {object[]} licenses
 * @returns {{
 *   licenseSpendByCurrency: {[currency: string]: number},
 *   poSpendByCurrency: {[currency: string]: number},
 *   spendDifferenceByCurrency: {[currency: string]: number},
 *   recurringAnnualCostByCurrency: {[currency: string]: number},
 *   lifecycleBudgetByStatus: {{ active: {[currency: string]: number}, expiring: {[currency: string]: number}, expired: {[currency: string]: number} }},
 *   recurringCount: number,
 *   poCount: number,
 *   overriddenPoCount: number,
 *   unkeyedCount: number,
 *   unpricedCount: number,
 * }}
 */
export function getCostOverview(licenses, { dateRange = "all" } = {}) {
  const range = resolveReportDateRange(dateRange);
  const spend = getSpendComparison(licenses, range);
  const recurringRecords = getRecurringRecords(licenses);

  const recurringAnnualCostByCurrency = {};
  for (const l of licenses) {
    if (!isForecastActive(l) || !isRecurringLicense(l)) continue;
    const cost = range ? getAllocatedRecurringLicenseValue(l, range) : getAnnualizedRecurringLicenseValue(l);
    if (cost.source === "missing") continue;
    const cur = l.currency || "USD";
    recurringAnnualCostByCurrency[cur] = (recurringAnnualCostByCurrency[cur] ?? 0) + cost.amount;
  }

  return {
    licenseSpendByCurrency: spend.licenseSpendByCurrency,
    poSpendByCurrency: spend.poSpendByCurrency,
    spendDifferenceByCurrency: spend.spendDifferenceByCurrency,
    recurringAnnualCostByCurrency,
    lifecycleBudgetByStatus: getLifecycleBudget(licenses, range),
    recurringCount: recurringRecords.length,
    poCount: spend.poCount,
    overriddenPoCount: spend.overriddenPoCount,
    unkeyedCount: spend.unkeyedCount,
    unpricedCount: spend.unpricedCount,
    isPeriodAllocated: Boolean(range),
  };
}

function addReportAmount(target, currency, amount) {
  if (!Number.isFinite(amount)) return;
  target[currency] = roundMoney((target[currency] ?? 0) + amount);
}

/**
 * Build the row-level purchase-order tracker used by the reports page.
 * PO overrides are treated as the authoritative PO value; otherwise the
 * priced license lines are summed. Unkeyed lines stay visible as one row per
 * currency so missing PO numbers cannot silently disappear from the report.
 */
export function getPurchaseOrderReport(licenses, { dateRange = "all" } = {}) {
  const range = resolveReportDateRange(dateRange);
  const groups = new Map();

  for (const license of licenses) {
    if (license.licenseType === "freeware" && license.maintenanceCoverage !== "included") continue;
    const currency = license.currency || "USD";
    const poNumber = (license.poNumber ?? "").trim();
    const cost = range && isRecurringLicense(license)
      ? getAllocatedLineValue(license, range)
      : getLicenseLineValue(license);
    const key = `${poNumber || "__unkeyed__"}::${currency}`;
    if (!groups.has(key)) {
      groups.set(key, {
        poNumber: poNumber || null,
        currency,
        publishers: [],
        lineCount: 0,
        pricedLineCount: 0,
        lineValue: 0,
        override: null,
      });
    }
    const group = groups.get(key);
    group.lineCount += 1;
    const publisher = (license.publisherName ?? "").trim();
    if (publisher && !group.publishers.includes(publisher)) group.publishers.push(publisher);
    if (cost.source !== "missing") {
      group.pricedLineCount += 1;
      group.lineValue = roundMoney(group.lineValue + cost.amount);
    }
    const override = parsePrice(license.poTotalOverride);
    if (group.override === null && override !== null) group.override = override;
  }

  const rows = Array.from(groups.values()).map((group) => {
    const poValue = group.override ?? group.lineValue;
    const difference = roundMoney(poValue - group.lineValue);
    return {
      ...group,
      publisher: group.publishers.length === 0
        ? "Unknown publisher"
        : group.publishers.length === 1 ? group.publishers[0] : "Multiple publishers",
      poValue,
      difference,
      status: group.poNumber === null
        ? "unkeyed"
        : group.override !== null && difference !== 0
          ? "override"
          : difference === 0 ? "reconciled" : "difference",
    };
  }).sort((a, b) => b.poValue - a.poValue || String(a.poNumber ?? "").localeCompare(String(b.poNumber ?? "")));

  const totalsByCurrency = {};
  const lineTotalsByCurrency = {};
  for (const row of rows) {
    addReportAmount(totalsByCurrency, row.currency, row.poValue);
    addReportAmount(lineTotalsByCurrency, row.currency, row.lineValue);
  }

  return {
    rows,
    totalsByCurrency,
    lineTotalsByCurrency,
    poCount: rows.filter((row) => row.poNumber !== null).length,
    unkeyedCount: rows.filter((row) => row.poNumber === null).reduce((sum, row) => sum + row.lineCount, 0),
    overriddenCount: rows.filter((row) => row.override !== null).length,
  };
}

/**
 * Summarize perpetual parents together with support recorded on the parent
 * or on linked maintenance records. Maintenance child values use their own
 * maintenance cost first, then their priced license line as a fallback.
 */
export function getPerpetualMaintenanceReport(licenses) {
  const maintenanceByParent = new Map();
  const maintenanceById = new Map();
  for (const license of licenses) {
    if (license.licenseType !== "maintenance") continue;
    const parentIds = new Set([
      ...(Array.isArray(license.maintenanceParentIds) ? license.maintenanceParentIds : []),
      ...(license.parentLicenseId != null ? [license.parentLicenseId] : []),
    ]);
    const cost = parsePrice(license.maintenanceCost);
    const fallback = getCalculatedLicenseValue(license);
    const maintenanceRecord = {
      id: license.id,
      amount: cost !== null ? cost : fallback.amount,
      currency: license.currency || "USD",
      publisher: license.publisherName || "Unknown",
      description: license.softwareDescription || "",
      poNumber: license.poNumber || "",
    };
    maintenanceById.set(license.id, maintenanceRecord);
    for (const parentId of parentIds) {
      if (!maintenanceByParent.has(parentId)) maintenanceByParent.set(parentId, []);
      maintenanceByParent.get(parentId).push(maintenanceRecord);
    }
  }

  const rows = licenses
    .filter((license) => license.licenseType === "perpetual")
    .map((license) => {
      const currency = license.currency || "USD";
      const purchase = getCalculatedLicenseValue(license);
      const linkedRecords = [
        ...(maintenanceByParent.get(license.id) ?? []),
        ...(Array.isArray(license.linkedMaintenanceIds)
          ? license.linkedMaintenanceIds.map((id) => maintenanceById.get(id)).filter(Boolean)
          : []),
      ];
      const linked = Array.from(new Map(linkedRecords.map((item) => [item.id, item])).values());
      let coverage = license.maintenanceCoverage || "unknown";
      let maintenance = 0;
      let maintenanceCurrency = currency;
      let maintenanceSource = "not_tracked";

      if (coverage === "included") {
        maintenance = parsePrice(license.maintenanceCost) ?? 0;
        maintenanceSource = parsePrice(license.maintenanceCost) !== null ? "included" : "included_missing";
      } else if (coverage === "separately_tracked" || linked.length > 0) {
        maintenance = linked.reduce((sum, item) => sum + item.amount, 0);
        maintenanceCurrency = linked[0]?.currency || currency;
        maintenanceSource = linked.length > 0 ? "separately_tracked" : "separate_missing";
      }

      return {
        id: license.id,
        publisher: license.publisherName || "Unknown",
        description: license.softwareDescription || "",
        poNumber: license.poNumber || "",
        currency,
        purchaseValue: purchase.amount,
        purchaseSource: purchase.source,
        maintenanceValue: maintenance,
        maintenanceCurrency,
        maintenanceSource,
        linkedMaintenanceCount: linked.length,
        maintenanceRecords: linked,
        totalValue: maintenanceCurrency === currency ? roundMoney(purchase.amount + maintenance) : null,
      };
    });

  const purchaseByCurrency = {};
  const maintenanceByCurrency = {};
  const totalByCurrency = {};
  for (const row of rows) {
    addReportAmount(purchaseByCurrency, row.currency, row.purchaseValue);
    addReportAmount(maintenanceByCurrency, row.maintenanceCurrency, row.maintenanceValue);
    if (row.totalValue !== null) addReportAmount(totalByCurrency, row.currency, row.totalValue);
  }

  return {
    rows,
    purchaseByCurrency,
    maintenanceByCurrency,
    totalByCurrency,
    includedCount: rows.filter((row) => row.maintenanceSource.startsWith("included")).length,
    separatelyTrackedCount: rows.filter((row) => row.maintenanceSource === "separately_tracked").length,
  };
}

/**
 * @param {object[]} licenses
 * @param {{ years?: number, annualGrowthPct?: number }} opts
 * @returns {{
 *   forecastRows: { year: number, baseline: number, growthAmount: number, projectedBudget: number }[],
 *   recurringRecords: object[],
 *   baselineByCurrency: {[currency: string]: number},
 *   singleCurrency: string | null,
 *   fallbackCount: number,
 * }}
 */
export function getBudgetForecast(licenses, { years = 5, annualGrowthPct = 0 } = {}) {
  const recurringRecords = getRecurringRecords(licenses);

  const baselineByCurrency = {};
  for (const r of recurringRecords) {
    if (r.costSource === "missing") continue;
    baselineByCurrency[r.currency] = (baselineByCurrency[r.currency] ?? 0) + r.annualCost;
  }

  const activeCurrencies = Object.keys(baselineByCurrency).filter((k) => baselineByCurrency[k] > 0);
  const singleCurrency = activeCurrencies.length === 1 ? activeCurrencies[0] : null;
  const baseline = singleCurrency ? baselineByCurrency[singleCurrency] : 0;

  const currentYear = new Date().getFullYear();
  const growthRate = Math.max(Number(annualGrowthPct) || 0, 0) / 100;

  // Forecast chart only makes sense for single-currency portfolios
  const forecastRows = singleCurrency
    ? Array.from({ length: Math.max(Number(years) || 1, 1) }, (_, index) => {
        const multiplier = Math.pow(1 + growthRate, index);
        const projectedBudget = roundMoney(baseline * multiplier);
        return {
          year: currentYear + index + 1,
          baseline: roundMoney(baseline),
          growthAmount: roundMoney(projectedBudget - baseline),
          projectedBudget,
        };
      })
    : [];

  return {
    forecastRows,
    recurringRecords: recurringRecords.sort((a, b) => b.annualCost - a.annualCost),
    baselineByCurrency,
    singleCurrency,
    fallbackCount: recurringRecords.filter((row) => row.costSource === "po_fallback").length,
  };
}

/**
 * @param {object[]} licenses
 * @returns {{ publisher: string, totalSpendByCurrency: {[currency: string]: number}, totalSpend: number, licenseCount: number }[]}
 */
export function getSpendByPublisher(licenses, { dateRange = "all" } = {}) {
  const map = new Map();
  const range = resolveReportDateRange(dateRange);

  for (const l of licenses) {
    const pub = l.publisherName || "Unknown";
    const cost = getReportLicenseValue(l, range);
    const cur = l.currency || "USD";

    if (!map.has(pub)) {
      map.set(pub, { publisher: pub, totalSpendByCurrency: {}, totalSpend: 0, licenseCount: 0 });
    }
    const entry = map.get(pub);
    entry.licenseCount += 1;
    if (cost.source !== "missing") {
      entry.totalSpendByCurrency[cur] = (entry.totalSpendByCurrency[cur] ?? 0) + cost.amount;
      entry.totalSpend += cost.amount; // sum for sort/chart ordering only
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend);
}

// Portfolio breakdown

const TYPE_LABEL = Object.fromEntries(LICENSE_TYPES.map((t) => [t.value, t.label]));
const METRIC_LABEL = Object.fromEntries(LICENSE_METRICS.map((m) => [m.value, m.label]));

/**
 * @param {object[]} licenses
 * @returns {{ byType: {name:string,value:number}[], byMetric: {name:string,value:number}[] }}
 */
export function getPortfolioBreakdown(licenses) {
  const typeMap = new Map();
  const metricMap = new Map();

  for (const l of licenses) {
    const typeKey = l.licenseType || "unknown";
    const typeLabel = TYPE_LABEL[typeKey] ?? typeKey;
    typeMap.set(typeLabel, (typeMap.get(typeLabel) ?? 0) + 1);

    const metricKey = l.licenseMetric || "unknown";
    const metricLabel = METRIC_LABEL[metricKey] ?? metricKey;
    metricMap.set(metricLabel, (metricMap.get(metricLabel) ?? 0) + 1);
  }

  const byType = Array.from(typeMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const byMetric = Array.from(metricMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return { byType, byMetric };
}

// Renewal calendar

/**
 * @param {object[]} licenses
 * @param {number} fiscalYearStartMonth - 1=Jan ... 12=Dec (default: 1)
 * @returns {{ quarterLabel: string, count: number, estimatedValueByCurrency: {[currency: string]: number}, estimatedValue: number }[]}
 */
export function getRenewalCalendar(licenses, fiscalYearStartMonth = 1) {
  const now = new Date();
  const fyStart0 = fiscalYearStartMonth - 1; // 0-indexed month of FY start

  // How many months into the current fiscal year are we?
  const monthOffset = (now.getMonth() - fyStart0 + 12) % 12;
  const currentFiscalQIndex = Math.floor(monthOffset / 3); // 0-3

  // Calendar month (0-indexed) and year of the start of the current fiscal quarter
  const fyQStartMonth0 = (fyStart0 + currentFiscalQIndex * 3) % 12;
  // If that month is later in the year than today, the FY started last calendar year
  const fyQStartYear = fyQStartMonth0 > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();

  // Build 4 quarters starting from the current fiscal quarter
  const quarters = [];
  for (let i = 0; i < 4; i++) {
    const qMonth0Raw = fyQStartMonth0 + i * 3;
    const qStartMonth0 = qMonth0Raw % 12;
    const qStartYear = fyQStartYear + Math.floor(qMonth0Raw / 12);
    const fiscalQ = (currentFiscalQIndex + i) % 4 + 1;
    quarters.push({
      label: `Q${fiscalQ} ${qStartYear}`,
      // new Date(y, m+3, 0) = last day of month m+2, JS handles month overflow
      from: new Date(qStartYear, qStartMonth0, 1),
      to: new Date(qStartYear, qStartMonth0 + 3, 0, 23, 59, 59),
      count: 0,
      estimatedValueByCurrency: {},
      estimatedValue: 0, // sum for chart only
    });
  }

  const eligible = licenses.filter(
    (l) => l.endDate && (l.expirationStatus === "active" || l.expirationStatus === "expiring")
  );

  for (const l of eligible) {
    const end = parseReportDate(l.endDate);
    for (const qtr of quarters) {
      if (end >= qtr.from && end <= qtr.to) {
        qtr.count += 1;
        const cost = getAnnualizedRecurringLicenseValue(l);
        if (cost.source !== "missing") {
          const cur = l.currency || "USD";
          qtr.estimatedValueByCurrency[cur] = (qtr.estimatedValueByCurrency[cur] ?? 0) + cost.amount;
          qtr.estimatedValue += cost.amount;
        }
        break;
      }
    }
  }

  return quarters.map(({ label, count, estimatedValueByCurrency, estimatedValue }) => ({
    quarterLabel: label,
    count,
    estimatedValueByCurrency,
    estimatedValue,
  }));
}

// Publisher/vendor relationship table

/**
 * @param {object[]} licenses
 * @returns {{ publisher: string, supplier: string, licenseCount: number, totalSpendByCurrency: {[currency: string]: number}, totalSpend: number, hasUnpricedLicenses: boolean }[]}
 */
export function getVendorTable(licenses, { dateRange = "all" } = {}) {
  const map = new Map();
  const range = resolveReportDateRange(dateRange);

  for (const l of licenses) {
    const publisher = l.publisherName || "Unknown";
    const supplier = l.supplier || "";
    const key = `${publisher}||${supplier}`;

    if (!map.has(key)) {
      map.set(key, { publisher, supplier, licenseCount: 0, totalSpendByCurrency: {}, totalSpend: 0, hasUnpricedLicenses: false });
    }
    const entry = map.get(key);
    entry.licenseCount += 1;

    const cost = getReportLicenseValue(l, range);
    if (cost.source !== "missing") {
      const cur = l.currency || "USD";
      entry.totalSpendByCurrency[cur] = (entry.totalSpendByCurrency[cur] ?? 0) + cost.amount;
      entry.totalSpend += cost.amount; // sum for sort only
    } else {
      entry.hasUnpricedLicenses = true;
    }
  }

  return Array.from(map.values());
}

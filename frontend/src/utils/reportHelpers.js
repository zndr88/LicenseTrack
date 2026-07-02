import { LICENSE_TYPES, LICENSE_METRICS } from "../constants/licenseData.js";

// ─── Filter ──────────────────────────────────────────────────────────────────

/**
 * @param {object[]} licenses
 * @param {{ includeRetired: boolean, dateRange: "all"|"thisYear"|"last12"|{from:string,to:string}, costCentres: string[] }} opts
 * @returns {object[]}
 */
export function filterLicenses(licenses, { includeRetired = false, dateRange = "all", costCentres = [] } = {}) {
  let result = licenses;

  if (!includeRetired) {
    result = result.filter((l) => !l.isRetired && !l.retired);
  }

  if (costCentres.length > 0) {
    result = result.filter((l) => costCentres.includes(l.costCentre ?? ""));
  }

  if (dateRange && dateRange !== "all") {
    const now = new Date();
    let from, to;

    if (dateRange === "thisYear") {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else if (dateRange === "last12") {
      to = now;
      from = new Date(now);
      from.setMonth(from.getMonth() - 12);
    } else if (typeof dateRange === "object" && dateRange.from && dateRange.to) {
      from = new Date(dateRange.from);
      to = new Date(dateRange.to);
    }

    if (from && to) {
      result = result.filter((l) => {
        if (!l.startDate) return true; // no start date → always include
        const sd = new Date(l.startDate);
        return sd >= from && sd <= to;
      });
    }
  }

  return result;
}

// ─── Spend helpers ────────────────────────────────────────────────────────────

function parsePrice(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(String(val).replace(",", "."));
  return isNaN(n) ? null : n;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getCalculatedLicenseValue(license) {
  const quantity = parsePrice(license.quantity);
  const unitPrice = parsePrice(license.unitPrice);

  if (quantity !== null && unitPrice !== null) {
    return {
      amount: quantity * unitPrice,
      source: "line",
    };
  }

  const totalPoPrice = parsePrice(license.totalPoPrice);
  if (totalPoPrice !== null) {
    return {
      amount: totalPoPrice,
      source: "po_fallback",
    };
  }

  return {
    amount: 0,
    source: "missing",
  };
}

function isRecurringLicense(license) {
  return ["subscription", "saas", "maintenance"].includes(license.licenseType);
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

function getLifecycleBudget(licenses) {
  const byStatus = {
    active: {},
    expiring: {},
    expired: {},
  };

  for (const l of licenses) {
    const status = l.expirationStatus === "perpetual" ? "active" : l.expirationStatus;
    if (!Object.prototype.hasOwnProperty.call(byStatus, status)) continue;

    const cost = getCalculatedLicenseValue(l);
    if (cost.source === "missing") continue;

    const cur = l.currency || "USD";
    byStatus[status][cur] = (byStatus[status][cur] ?? 0) + cost.amount;
  }

  return byStatus;
}

export function getLifecycleCounts(licenses) {
  const counts = {
    active: 0,
    expiring: 0,
    expired: 0,
  };

  for (const l of licenses) {
    if (l.expirationStatus === "active" || l.expirationStatus === "perpetual") {
      counts.active += 1;
    } else if (l.expirationStatus === "expiring") {
      counts.expiring += 1;
    } else if (l.expirationStatus === "expired") {
      counts.expired += 1;
    }
  }

  return counts;
}

function getHistoricalTotalSpend(licenses) {
  const seenPoNumbers = new Set();
  const byCurrency = {};
  let unpricedCount = 0;

  for (const l of licenses) {
    const price = parsePrice(l.totalPoPrice);
    if (price === null) {
      unpricedCount += 1;
      continue;
    }

    const poNumber = (l.poNumber ?? "").trim();
    if (poNumber) {
      if (seenPoNumbers.has(poNumber)) continue;
      seenPoNumbers.add(poNumber);
    }

    const cur = l.currency || "USD";
    byCurrency[cur] = (byCurrency[cur] ?? 0) + price;
  }

  return {
    byCurrency,
    poCount: seenPoNumbers.size,
    unpricedCount,
  };
}

function getRecurringRecords(licenses) {
  const records = [];

  for (const l of licenses) {
    if (!isForecastActive(l) || !isRecurringLicense(l)) continue;

    const cost = getCalculatedLicenseValue(l);
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
 *   totalSpendByCurrency: {[currency: string]: number},
 *   recurringAnnualCostByCurrency: {[currency: string]: number},
 *   nonRecurringSpendByCurrency: {[currency: string]: number},
 *   lifecycleBudgetByStatus: {{ active: {[currency: string]: number}, expiring: {[currency: string]: number}, expired: {[currency: string]: number} }},
 *   recurringCount: number,
 *   poCount: number,
 *   fallbackCount: number,
 *   missingPoTotalCount: number,
 *   unpricedCount: number,
 * }}
 */
export function getCostOverview(licenses) {
  const historical = getHistoricalTotalSpend(licenses);
  const recurringRecords = getRecurringRecords(licenses);

  const recurringAnnualCostByCurrency = {};
  for (const r of recurringRecords) {
    recurringAnnualCostByCurrency[r.currency] = (recurringAnnualCostByCurrency[r.currency] ?? 0) + r.annualCost;
  }

  const nonRecurringSpendByCurrency = {};
  for (const [cur, total] of Object.entries(historical.byCurrency)) {
    const recurring = recurringAnnualCostByCurrency[cur] ?? 0;
    const diff = total - recurring;
    if (diff > 0) nonRecurringSpendByCurrency[cur] = diff;
  }

  return {
    totalSpendByCurrency: historical.byCurrency,
    recurringAnnualCostByCurrency,
    nonRecurringSpendByCurrency,
    lifecycleBudgetByStatus: getLifecycleBudget(licenses),
    recurringCount: recurringRecords.length,
    poCount: historical.poCount,
    fallbackCount: recurringRecords.filter((row) => row.costSource === "po_fallback").length,
    missingPoTotalCount: historical.unpricedCount,
    unpricedCount: licenses.filter((license) => getCalculatedLicenseValue(license).source === "missing").length,
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
export function getSpendByPublisher(licenses) {
  const map = new Map();

  for (const l of licenses) {
    const pub = l.publisherName || "Unknown";
    const cost = getCalculatedLicenseValue(l);
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

// ─── Portfolio breakdown ──────────────────────────────────────────────────────

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

// ─── Renewal calendar ─────────────────────────────────────────────────────────

/**
 * @param {object[]} licenses
 * @param {number} fiscalYearStartMonth - 1=Jan … 12=Dec (default: 1)
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
    const end = new Date(l.endDate);
    for (const qtr of quarters) {
      if (end >= qtr.from && end <= qtr.to) {
        qtr.count += 1;
        const cost = getCalculatedLicenseValue(l);
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

// ─── Publisher/vendor relationship table ─────────────────────────────────────

/**
 * @param {object[]} licenses
 * @returns {{ publisher: string, supplier: string, licenseCount: number, totalSpendByCurrency: {[currency: string]: number}, totalSpend: number, hasUnpricedLicenses: boolean }[]}
 */
export function getVendorTable(licenses) {
  const map = new Map();

  for (const l of licenses) {
    const publisher = l.publisherName || "Unknown";
    const supplier = l.supplier || "";
    const key = `${publisher}||${supplier}`;

    if (!map.has(key)) {
      map.set(key, { publisher, supplier, licenseCount: 0, totalSpendByCurrency: {}, totalSpend: 0, hasUnpricedLicenses: false });
    }
    const entry = map.get(key);
    entry.licenseCount += 1;

    const cost = getCalculatedLicenseValue(l);
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

import { useMemo } from "react";
import { daysBetween, getCompleteness, getExpirationStatus, todayStr } from "../utils/helpers.js";
import { parseLocalizedNumber } from "../utils/formatting.js";
import { finiteNumber, getSortValue } from "../utils/sort.js";

function statNumber(value, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

const FILTER_FIELD_BY_COLUMN = {
  recordId: "id",
  licenseRef: "licenseRef",
  externalRef: "externalRef",
  invoiceNumber: "invoiceNumber",
  contactEmail: "contactEmail",
  budgetOwnerEmail: "budgetOwnerEmail",
  currency: "currency",
  requestDate: "requestDate",
  purchaseDate: "purchaseDate",
  portalUrl: "portalUrl",
  notes: "notes",
  createdBy: "createdByName",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  lifecycleStatus: "lifecycleStatus",
  syncStatus: "syncStatus",
  lastSyncedAt: "lastSyncedAt",
  maintenanceStartDate: "maintenanceStartDate",
  maintenanceEndDate: "maintenanceEndDate",
  maintenanceCost: "maintenanceCost",
};

export function useLicenseData(licenses, {
  search,
  statusFilters,
  columnFilters = {},
  currentPage,
  pageSize,
  sortCol,
  sortDir,
  globalSettings,
  userSettings,
  apiStats,
  customFieldDefs = [],
  customFieldValuesMap = new Map(),
}) {
  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);
  const numberFormatLocale = userSettings?.numberFormatLocale ?? "en-US";

  const activeStatusFilters = useMemo(() => {
    const values = new Set(statusFilters);
    const lifecycleKeys = ["active", "upcoming", "expiring", "expired", "pending_renewal", "renewed", "retired", "legacy"];
    const completenessKeys = ["complete", "incomplete"];
    return {
      values,
      hasLifecycleFilters: lifecycleKeys.some((key) => values.has(key)),
      hasCompletenessFilters: completenessKeys.some((key) => values.has(key)),
    };
  }, [statusFilters]);

  const activeColumnFilters = useMemo(() => Object.entries(columnFilters)
    .map(([key, raw]) => {
      if (Array.isArray(raw)) return raw.length > 0 ? [key, raw] : null;
      const value = (raw ?? "").trim().toLowerCase();
      return value ? [key, value] : null;
    })
    .filter(Boolean), [columnFilters]);

  const enriched = useMemo(() => licenses.map((l) => {
    let completeness;
    if (l.isCompletenessExempt) {
      completeness = { percentage: null, checks: [], isComplete: false, isPending: false, isExempt: true };
    } else if (l.completenessPct !== undefined && l.completenessPct !== null) {
      completeness = { percentage: l.completenessPct, checks: [], isComplete: l.completenessPct >= 100, isPending: false };
    } else {
      completeness = getCompleteness(l, globalSettings.mandatoryFields ?? {});
    }

    let expiration;
    if (l.expirationStatus) {
      const days = l.daysUntilExpiry;
      let label;
      if (l.expirationStatus === "expired") label = `Expired ${Math.abs(days ?? 0)}d ago`;
      else if (l.expirationStatus === "expiring") label = `Expires in ${days}d`;
      else if (l.expirationStatus === "active") label = days !== null && days !== undefined ? `${days}d remaining` : "Active";
      else if (l.expirationStatus === "upcoming") {
        const startDays = l.startDate ? daysBetween(todayStr(), l.startDate) : null;
        label = startDays !== null && startDays > 0 ? `Starts in ${startDays}d` : "Upcoming";
      }
      else if (l.expirationStatus === "perpetual") label = "Perpetual";
      else if (l.expirationStatus === "renewed") label = "Renewed";
      else if (l.expirationStatus === "pending_renewal") label = "Pending Renewal";
      else if (l.expirationStatus === "retired") label = "Retired";
      else if (l.expirationStatus === "legacy") label = "Legacy";
      else label = l.expirationStatus;
      expiration = { status: l.expirationStatus, days, label };
    } else {
      expiration = getExpirationStatus(
        l.endDate,
        globalSettings.notificationDays,
        l.retired,
        l.lifecycleStatus,
        l.renewedToId,
        l.startDate,
        l.licenseType,
      );
    }

    return { ...l, completeness, expiration };
  }), [licenses, globalSettings.mandatoryFields, globalSettings.notificationDays]);

  const filtered = useMemo(() => enriched.filter((l) => {
    if (normalizedSearch) {
      const hay = `${l.licenseRef || ""} ${(l.licenseRefAliases || []).join(" ")} ${l.publisherName} ${l.softwareDescription} ${l.contractNumber} ${l.poNumber} ${l.procurementReference || ""} ${l.supplier || ""}`.toLowerCase();
      if (!hay.includes(normalizedSearch)) return false;
    }
    if (activeStatusFilters.hasLifecycleFilters) {
      const { values } = activeStatusFilters;
      const matchesLifecycle = (
        (values.has("active") && (l.expiration.status === "active" || l.expiration.status === "perpetual")) ||
        (values.has("upcoming") && l.expiration.status === "upcoming") ||
        (values.has("expiring") && l.expiration.status === "expiring") ||
        (values.has("expired") && l.expiration.status === "expired") ||
        (values.has("pending_renewal") && l.expiration.status === "pending_renewal") ||
        (values.has("renewed") && l.expiration.status === "renewed") ||
        (values.has("retired") && l.expiration.status === "retired") ||
        (values.has("legacy") && l.expiration.status === "legacy")
      );
      if (!matchesLifecycle) return false;
    }

    if (activeStatusFilters.hasCompletenessFilters) {
      const { values } = activeStatusFilters;
      const matchesCompleteness = (
        (values.has("complete") && l.completeness.isComplete) ||
        (values.has("incomplete") && !l.completeness.isExempt && !l.completeness.isComplete)
      );
      if (!matchesCompleteness) return false;
    }
    // Column filters - AND logic, applied after existing filters
    if (activeColumnFilters.length > 0) {
      for (const [key, val] of activeColumnFilters) {
        switch (key) {
          case "publisher":
            if (!l.publisherName?.toLowerCase().includes(val)) return false;
            break;
          case "description":
            if (!l.softwareDescription?.toLowerCase().includes(val)) return false;
            break;
          case "contractNumber":
            if (!l.contractNumber?.toLowerCase().includes(val)) return false;
            break;
          case "poNumber":
            if (!l.poNumber?.toLowerCase().includes(val)) return false;
            break;
          case "procurementReference":
            if (!l.procurementReference?.toLowerCase().includes(val)) return false;
            break;
          case "costCentre":
            if (Array.isArray(val)) {
              if (val.length > 0 && !val.includes(l.costCentre)) return false;
            } else {
              if (!l.costCentre?.toLowerCase().includes(val)) return false;
            }
            break;
          case "supplier":
            if (!(l.supplier || "Direct").toLowerCase().includes(val)) return false;
            break;
          case "skuCode":
            if (!l.skuCode?.toLowerCase().includes(val)) return false;
            break;
          case "createdBy": {
            const createdBy = l.createdByName || l.createdByEmail || (l.createdBy ? `User #${l.createdBy}` : "Unknown / legacy record");
            if (!createdBy.toLowerCase().includes(val)) return false;
            break;
          }
          case "licenseType":
            if (Array.isArray(val)) {
              if (val.length > 0 && !val.includes(l.licenseType)) return false;
            } else {
              if (l.licenseType !== val) return false;
            }
            break;
          case "licenseMetric":
            if (Array.isArray(val)) {
              if (val.length > 0 && !val.includes(l.licenseMetric)) return false;
            } else {
              if (l.licenseMetric !== val) return false;
            }
            break;
          case "quantity":
            if (!String(l.quantity ?? "").includes(val)) return false;
            break;
          case "effectiveQuantity":
            if (!String(l.effectiveQuantity ?? "").includes(val)) return false;
            break;
          case "quantityPerUnit":
            if (!String(l.quantityPerUnit ?? "").includes(val)) return false;
            break;
          case "noticeDate":
            if (!String(l.noticeDate ?? "").toLowerCase().includes(val)) return false;
            break;
          case "unitPrice":
            if (!String(l.unitPrice ?? "").includes(parseLocalizedNumber(val, { numberFormatLocale }) ?? val)) return false;
            break;
          case "totalPoPrice":
            if (!String(l.totalPoPrice ?? "").includes(parseLocalizedNumber(val, { numberFormatLocale }) ?? val)) return false;
            break;
          case "calcTotal": {
            const qty = Number(l.quantity);
            const unit = Number(l.unitPrice);
            const calc = (Number.isFinite(qty) && Number.isFinite(unit)) ? String(qty * unit) : "";
            if (!calc.includes(parseLocalizedNumber(val, { numberFormatLocale }) ?? val)) return false;
            break;
          }
          case "maintenanceCoverage":
            if (Array.isArray(val)) {
              if (val.length > 0 && !val.includes(l.maintenanceCoverage)) return false;
            } else if (l.maintenanceCoverage !== val) {
              return false;
            }
            break;
          case "startDate":
            if (!l.startDate?.toLowerCase().includes(val)) return false;
            break;
          case "endDate":
            if (!l.endDate?.toLowerCase().includes(val)) return false;
            break;
          case "datesFrom":
            if (Array.isArray(val)) {
              if (val.length > 0 && !val.includes(l.startDate?.slice(0, 4))) return false;
            } else {
              if (l.startDate && val > l.startDate.slice(0, val.length)) return false;
            }
            break;
          case "datesTo":
            if (Array.isArray(val)) {
              if (val.length > 0) {
                if (!l.endDate) return false;
                if (!val.includes(l.endDate.slice(0, 4))) return false;
              }
            } else {
              if (l.endDate && val < l.endDate.slice(0, val.length)) return false;
            }
            break;
          default: {
            if (key.startsWith("cf_")) {
              const def = customFieldDefs.find((item) => String(item.fieldKey ?? item.field_key ?? "").replace(/^cf_/, "") === key.slice(3).replace(/^cf_/, ""));
              const entry = (customFieldValuesMap.get(l.id) ?? []).find((item) => item.customFieldDefId === def?.id);
              const fieldType = def?.fieldType ?? def?.field_type;
              const raw = entry ? (fieldType === "currency" ? entry.valueCurrency : entry.valueText) : null;
              let display = raw;
              if (fieldType === "boolean") display = raw === true || raw === "true" ? "True" : raw === false || raw === "false" ? "False" : "";
              if (fieldType === "currency" || fieldType === "number") {
                const numeric = finiteNumber(raw);
                const input = parseLocalizedNumber(val, { numberFormatLocale });
                if (numeric === null || input === null || numeric !== Number(input)) return false;
              } else if (!String(display ?? "").toLowerCase().includes(val)) return false;
              continue;
            }
            const field = FILTER_FIELD_BY_COLUMN[key];
            if (field && !String(l[field] ?? "").toLowerCase().includes(val)) return false;
            break;
          }
        }
      }
    }

    return true;
  }), [enriched, normalizedSearch, activeStatusFilters, activeColumnFilters, numberFormatLocale, customFieldDefs, customFieldValuesMap]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const direction = sortDir === "asc" ? 1 : -1;
    return filtered
      .map((license, index) => ({ license, index, value: getSortValue(license, sortCol, { allLicenses: licenses, customFieldValuesMap, customFieldDefs }) }))
      .sort((a, b) => {
        const aVal = a.value;
        const bVal = b.value;
        const aMissing = aVal === null || aVal === undefined || (typeof aVal === "number" && !Number.isFinite(aVal));
        const bMissing = bVal === null || bVal === undefined || (typeof bVal === "number" && !Number.isFinite(bVal));
        // Nulls always sort to the end regardless of direction
        if (aMissing && bMissing) return a.index - b.index;
        if (aMissing) return 1;
        if (bMissing) return -1;
        let cmp;
        if (typeof aVal === "number" && typeof bVal === "number") {
          cmp = aVal - bVal;
        } else {
          cmp = collator.compare(String(aVal), String(bVal));
        }
        if (cmp === 0) return a.index - b.index;
        return direction * cmp;
      })
      .map(({ license }) => license);
  }, [filtered, licenses, sortCol, sortDir, customFieldDefs, customFieldValuesMap]);

  const stats = useMemo(() => {
    if (apiStats) {
      const hasBackendActiveTotal = apiStats.total_active !== undefined;
      const expiring = statNumber(apiStats.total_expiring, statNumber(apiStats.expiring));
      const active = hasBackendActiveTotal
        ? statNumber(apiStats.total_active) - expiring
        : statNumber(apiStats.active);

      return {
        total: statNumber(apiStats.total),
        active,
        expiring,
        expired: statNumber(apiStats.total_expired, statNumber(apiStats.expired)),
        upcoming: statNumber(apiStats.total_upcoming, statNumber(apiStats.upcoming)),
        pending: statNumber(apiStats.total_pending, statNumber(apiStats.pending)),
        incomplete: statNumber(apiStats.total_incomplete, statNumber(apiStats.incomplete)),
        retired: statNumber(apiStats.total_retired, statNumber(apiStats.retired)),
        renewed: statNumber(apiStats.total_renewed, statNumber(apiStats.renewed)),
        legacy: statNumber(apiStats.total_legacy, statNumber(apiStats.legacy)),
        costByCurrency: apiStats.annual_cost_by_currency ?? null,
        excludedFromTotals: apiStats.excluded_from_totals ?? 0,
      };
    }

    // Client-side fallback: group cost by currency
    const costByCurrency = {};
    for (const l of licenses) {
      if (l.retired || l.lifecycleStatus === "pending_renewal" || l.lifecycleStatus === "legacy" || l.renewedToId) continue;
      const cost = (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
      if (cost > 0) {
        const cur = l.currency || "USD";
        costByCurrency[cur] = (costByCurrency[cur] ?? 0) + cost;
      }
    }

    return {
    total: licenses.length,
    active: enriched.filter((l) => l.expiration.status === "active" || l.expiration.status === "perpetual").length,
    expiring: enriched.filter((l) => l.expiration.status === "expiring").length,
    expired: enriched.filter((l) => l.expiration.status === "expired").length,
    upcoming: enriched.filter((l) => l.expiration.status === "upcoming").length,
    pending: enriched.filter((l) => l.expiration.status === "pending_renewal").length,
    incomplete: enriched.filter((l) => !l.completeness.isExempt && !l.completeness.isComplete && !l.completeness.isPending && l.expiration.status !== "retired" && l.expiration.status !== "renewed" && l.expiration.status !== "pending_renewal" && l.expiration.status !== "legacy").length,
    retired: enriched.filter((l) => l.expiration.status === "retired").length,
    renewed: enriched.filter((l) => l.expiration.status === "renewed").length,
    legacy: enriched.filter((l) => l.expiration.status === "legacy").length,
    costByCurrency,
    excludedFromTotals: 0,
    };
  }, [apiStats, enriched, licenses]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sorted.length / pageSize)),
    [sorted, pageSize],
  );

  const paginatedItems = useMemo(
    () => {
      const effectivePage = Math.min(Math.max(1, currentPage), totalPages);
      return sorted.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
    },
    [sorted, currentPage, pageSize, totalPages]
  );

  const departments = useMemo(() => [...new Set(licenses.map((l) => l.costCentre).filter(Boolean))].sort(), [licenses]);
  const startYears = useMemo(() => [...new Set(licenses.map((l) => l.startDate?.slice(0, 4)).filter(Boolean))].sort().reverse(), [licenses]);

  return {
    enriched,
    filtered,
    sorted,
    stats,
    paginatedItems,
    totalPages,
    departments,
    startYears,
  };
}

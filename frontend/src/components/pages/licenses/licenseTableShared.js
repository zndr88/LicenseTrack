export const VIRTUAL_THRESHOLD = 500;

export const NON_FILTERABLE_COLUMNS = ["select", "docs", "expiration", "status", "complete", "totalPoPrice", "calcTotal"];

export function isColumnFilterable(col) {
  return Boolean(col) && !NON_FILTERABLE_COLUMNS.includes(col.key);
}

export function rowStyle(license) {
  if (license.expiration.status === "retired") return { opacity: 0.5 };
  if (license.expiration.status === "legacy") return { opacity: 0.55 };
  if (license.expiration.status === "renewed") return { opacity: 0.45, background: "var(--steel-dim)" };
  if (license.expiration.status === "pending_renewal") return { background: "var(--purple-dim)", borderLeft: "3px solid var(--purple)" };
  if (license.expiration.status === "upcoming") return { background: "var(--steel-dim)", borderLeft: "3px solid var(--steel)" };
  if (license.expiration.status === "expiring") return { background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)" };
  if (license.expiration.status === "expired") return { background: "var(--red-dim)", borderLeft: "3px solid var(--red)" };
  return undefined;
}

export function getVisibleColumns(activeColumns, visList) {
  return activeColumns.filter((col) => {
    if (col.always) return true;
    if ((col.settingsKey && visList[col.settingsKey] === false)
      || ((col.key === "startDate" || col.key === "endDate") && visList.dates === false)) {
      return false;
    }
    return visList[col.key];
  });
}

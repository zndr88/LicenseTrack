/**
 * URL <-> app page mapping for deep links. The app keeps page state in React;
 * these pure helpers translate it to and from browser paths.
 */

export const PAGE_PATHS = Object.freeze({
  licenses: "licenses",
  "renewal-workbench": "renewals",
  sourcing: "sourcing",
  "pending-orders": "pending-orders",
  notifications: "notifications",
  reports: "reports",
  contracts: "contracts",
  admin: "admin",
  "user-settings": "settings",
  import: "import",
  help: "help",
});

const PAGE_BY_SEGMENT = Object.freeze(
  Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, segment]) => [segment, page])),
);

export const DEFAULT_PAGE = "licenses";

function normalizeBase(basePath = "/") {
  const trimmed = String(basePath || "/").replace(/\/+$/, "");
  return `${trimmed}/`;
}

/** Build the browser path for a page, and for the Licenses page an optional selected license. */
export function pathForState({ page, licenseKey = null }, basePath = "/") {
  const segment = PAGE_PATHS[page] ?? PAGE_PATHS[DEFAULT_PAGE];
  const licensePart = page === "licenses" && licenseKey != null && licenseKey !== ""
    ? `/${encodeURIComponent(String(licenseKey))}`
    : "";
  return `${normalizeBase(basePath)}${segment}${licensePart}`;
}

/**
 * Parse a browser path into { page, licenseKey, known }. Unknown paths fall back
 * to the Licenses page with known=false so callers can rewrite the URL.
 */
export function parseAppPath(pathname, basePath = "/") {
  const base = normalizeBase(basePath);
  const path = String(pathname || "/");
  const relative = path.startsWith(base) ? path.slice(base.length) : path.replace(/^\/+/, "");
  const [segment = "", licenseSegment = "", ...rest] = relative.split("/").filter(Boolean);
  if (!segment) return { page: DEFAULT_PAGE, licenseKey: null, known: true };
  const page = PAGE_BY_SEGMENT[segment];
  if (!page || rest.length > 0 || (licenseSegment && page !== "licenses")) {
    return { page: DEFAULT_PAGE, licenseKey: null, known: false };
  }
  return {
    page,
    licenseKey: licenseSegment ? decodeURIComponent(licenseSegment) : null,
    known: true,
  };
}

/**
 * License Details sections a link can open, as URL hash -> section key. The
 * hash names follow the visible section titles, e.g. /licenses/20#documents.
 * Identity is always open, so it has no hash.
 */
const DETAIL_SECTION_BY_HASH = Object.freeze({
  "key-dates": "dates",
  details: "commercial",
  maintenance: "maintenance",
  relationships: "people",
  documents: "documents",
  completeness: "completeness",
  notes: "notes",
  "custom-fields": "customFields",
  history: "history",
});

const DETAIL_HASH_BY_SECTION = Object.freeze(
  Object.fromEntries(Object.entries(DETAIL_SECTION_BY_HASH).map(([hash, section]) => [section, hash])),
);

/** The License Details section named by a URL hash ("#documents"), or null. */
export function detailSectionFromHash(hash) {
  let name = String(hash ?? "").replace(/^#/, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  name = name.trim().toLowerCase();
  return Object.hasOwn(DETAIL_SECTION_BY_HASH, name) ? DETAIL_SECTION_BY_HASH[name] : null;
}

/** The URL hash for a License Details section ("#documents"), or "" when it has none. */
export function hashForDetailSection(section) {
  return Object.hasOwn(DETAIL_HASH_BY_SECTION, section) ? `#${DETAIL_HASH_BY_SECTION[section]}` : "";
}

/** Whether a browser path points at this license, by record id or LT Ref (or alias). */
export function pathMatchesLicense(pathname, license, basePath = "/") {
  if (!license) return false;
  const { page, licenseKey } = parseAppPath(pathname, basePath);
  if (page !== "licenses" || !licenseKey) return false;
  const key = String(licenseKey).trim();
  if (/^\d+$/.test(key)) return Number(key) === license.id;
  const upper = key.toUpperCase();
  return String(license.licenseRef ?? "").toUpperCase() === upper
    || (license.licenseRefAliases ?? []).some((alias) => String(alias).toUpperCase() === upper);
}

/**
 * Resolve a /licenses/:key segment to a license id. Numeric keys are record ids;
 * other keys are LT Refs (or aliases). A ref is shared by a renewal chain, so the
 * current term wins: not renewed/legacy, then the latest start date.
 */
export function resolveLicenseKey(licenseKey, licenses = []) {
  if (licenseKey == null || licenseKey === "") return null;
  const key = String(licenseKey).trim();
  if (/^\d+$/.test(key)) {
    const id = Number(key);
    return licenses.some((license) => license.id === id) ? id : null;
  }
  const upper = key.toUpperCase();
  const matches = licenses.filter((license) => (
    String(license.licenseRef ?? "").toUpperCase() === upper
    || (license.licenseRefAliases ?? []).some((alias) => String(alias).toUpperCase() === upper)
  ));
  if (!matches.length) return null;
  const rank = (license) => (["renewed", "legacy"].includes(license.lifecycleStatus) || license.renewedToId ? 1 : 0);
  const [best] = [...matches].sort((a, b) => (
    rank(a) - rank(b)
    || String(b.startDate ?? "").localeCompare(String(a.startDate ?? ""))
    || b.id - a.id
  ));
  return best.id;
}

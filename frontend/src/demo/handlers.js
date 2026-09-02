import {
  store, seedStore, resetStore, nextId, decorateLicense, computeStats, computeDepartments,
  computeNotifications, computePortfolioReportStats, withComputedCompleteness,
  buildContractResponse, buildContractLicenseRows, renameContractNumberOnLicenses,
  backfillMissingSourcingRequests, buildSourcingItem, buildSourcingRequestResponse,
  ensureSourcingRequestForItem, assertSourcingItemEditable, convertSourcingItemToOrder,
  convertSourcingRequestToOrder, mergeCotermSourcingItems, handleSourcingItemDeleteSideEffects,
  sourcingItemPredecessorIds,
  cleanProcurementIdentity, procurementIdentitiesMatch, synchronizeOpenSourcingRequestIdentity,
  convertFreewareSourcingItems,
  ensurePendingOrderEditable, createPendingOrderRecord, deletePendingOrderRecord, cancelPendingOrderRecord,
  addPendingOrderItemsBulk, rebuildPendingOrderItems, withPendingOrderLicenseRefs,
  convertPendingOrderToLicenses, batchConvertPendingOrderToLicenses, buildLicenseProcurementTrail,
  buildRenewalWorkbenchRows, initiateRenewalBundleRecord,
} from "./store.js";
import { buildLicense } from "./fixtures.js";
import { datetimeDaysAgo } from "./time.js";
import {
  filterLicenses, getBudgetForecast, getCostOverview, getLifecycleCounts,
  getSpendByPublisher, getPortfolioBreakdown, getRenewalCalendar, getVendorTable,
  getPurchaseOrderReport, getPerpetualMaintenanceReport,
} from "../utils/reportHelpers.js";

function buildDemoDetailedReport(query) {
  const dateRange = query.get("date_range") || "all";
  const effectiveRange = dateRange === "custom"
    ? { from: query.get("date_from"), to: query.get("date_to") }
    : dateRange;
  const filters = {
    includeRetired: query.get("include_retired") === "true",
    dateRange,
    dateFrom: query.get("date_from") || undefined,
    dateTo: query.get("date_to") || undefined,
    costCentres: query.getAll("cost_centres"),
    forecastYears: Number(query.get("forecast_years") || 5),
    forecastGrowthPct: Number(query.get("annual_uplift_pct") || 0),
    fiscalYearStartMonth: Number(query.get("fiscal_year_start_month") || 1),
  };
  const filtered = filterLicenses(store.licenses, {
    includeRetired: filters.includeRetired,
    dateRange: effectiveRange,
    costCentres: filters.costCentres,
  });
  const costOverview = {
    ...getCostOverview(filtered, { dateRange: effectiveRange }),
    undatedCount: 0,
  };
  return {
    generatedAt: new Date().toISOString(),
    filters,
    availableCostCentres: [...new Set(store.licenses.map((license) => license.costCentre).filter(Boolean))].sort(),
    currencyDisclaimer: "All monetary values remain in their native currencies. No currency conversion is applied.",
    counts: { records: filtered.length, ...getLifecycleCounts(filtered), incomplete: 0, unpriced: costOverview.unpricedCount, excluded: 0, undated: 0, unallocated: 0 },
    financialSummaries: costOverview,
    costOverview,
    budgetForecast: getBudgetForecast(filtered, { years: filters.forecastYears, annualGrowthPct: filters.forecastGrowthPct }),
    publisherData: getSpendByPublisher(filtered, { dateRange: effectiveRange }),
    vendorData: getVendorTable(filtered, { dateRange: effectiveRange }),
    portfolioData: getPortfolioBreakdown(filtered),
    renewalData: getRenewalCalendar(filtered, filters.fiscalYearStartMonth),
    perpetualMaintenanceData: getPerpetualMaintenanceReport(filtered),
    purchaseOrderData: getPurchaseOrderReport(filtered, { dateRange: effectiveRange }),
  };
}

function demoCsvCell(value) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text.trim()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function buildDemoReportCsv(query) {
  const report = buildDemoDetailedReport(query);
  const headers = ["Report Type", "Row Type", "Record ID", "Publisher", "Supplier", "Currency", "Amount", "Difference", "Count", "Status", "Event Date"];
  const rows = [headers];
  const add = (values) => rows.push(values.map(demoCsvCell));
  for (const [name, values] of Object.entries(report.financialSummaries)) {
    if (name === "lifecycleBudgetByStatus") continue;
    for (const [currency, amount] of Object.entries(values || {})) add(["summary", name, "", "", "", currency, amount]);
  }
  for (const row of report.budgetForecast.recurringRecords || []) add(["budget_forecast", "recurring_record", row.licenseId, row.publisher, row.supplier, row.currency, row.annualCost, "", 1, row.costSource]);
  for (const row of report.publisherData || []) for (const [currency, amount] of Object.entries(row.totalSpendByCurrency || {})) add(["publisher", "publisher_currency", "", row.publisher, "", currency, amount, "", row.licenseCount]);
  for (const row of report.vendorData || []) for (const [currency, amount] of Object.entries(row.totalSpendByCurrency || {})) add(["vendor", "vendor_currency", "", row.publisher, row.supplier, currency, amount, "", row.licenseCount]);
  for (const row of report.renewalData || []) for (const event of row.events || []) add(["renewal", row.quarterLabel, event.licenseId, event.publisher, "", event.currency, event.renewalValue, "", 1, event.renewalKind, event.eventDate]);
  for (const row of report.purchaseOrderData.rows || []) add(["purchase_order", "procurement_identity", "", row.publisher, "", row.currency, row.poValue, row.difference, row.lineCount, row.status]);
  return rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
}

// Mirrors backend/app/services/license_write_service.py:42-66 ALLOWED_PATCH_FIELDS
// (camelCase keys match 1:1 with the demo store's field names, so no snake_case
// remapping is needed here).
const FIELD_PATCH_ALLOWED = new Set([
  "publisherName", "softwareDescription", "licenseType", "licenseMetric", "portalUrl",
  "quantity", "skuCode", "unitPrice", "totalPoPrice", "currency", "startDate", "endDate",
  "requestDate", "purchaseDate", "contractNumber", "poNumber", "invoiceNumber", "contactEmail",
  "supplier", "costCentre", "budgetOwnerEmail", "notes", "maintenanceCoverage",
]);
const DATE_PATCH_FIELDS = new Set(["startDate", "endDate"]);

// Mirrors backend/app/services/maintenance_rules.py:30-34 MAINTENANCE_PARENT_TYPES.
const MAINTENANCE_PARENT_TYPES = new Set(["perpetual", "oem", "freeware"]);

function findLicenseOr404(id) {
  const license = store.licenses.find((l) => l.id === id);
  if (!license) throw new Error("License not found");
  return license;
}

function hasMaintenanceParent(license, parentId) {
  if (Number(license.parentLicenseId) === Number(parentId)) return true;
  return (license.maintenanceParentIds || []).some((id) => Number(id) === Number(parentId));
}

function linkMaintenanceToParentRecord(maintenance, parent) {
  if (maintenance.licenseType !== "maintenance") {
    throw new Error("Only maintenance licenses can be linked to maintenance/support parents");
  }
  if (!MAINTENANCE_PARENT_TYPES.has(parent.licenseType)) {
    throw new Error("Maintenance/support tracking can only be linked to perpetual, OEM, or freeware Licenses.");
  }
  if (!hasMaintenanceParent(maintenance, parent.id)) {
    maintenance.maintenanceParentIds = [...(maintenance.maintenanceParentIds || []), parent.id];
  }
  if (maintenance.parentLicenseId == null) maintenance.parentLicenseId = parent.id;
  if (!(parent.linkedMaintenanceIds || []).some((id) => Number(id) === Number(maintenance.id))) {
    parent.linkedMaintenanceIds = [...(parent.linkedMaintenanceIds || []), maintenance.id];
  }
  parent.activeMaintenanceId = maintenance.id;
  parent.hasMaintenance = true;
  parent.maintenanceCoverage = "separately_tracked";
  parent.maintenanceStartDate = maintenance.startDate;
  parent.maintenanceEndDate = maintenance.endDate;
  parent.maintenanceCost = maintenance.totalPoPrice || maintenance.unitPrice || null;
  decorateLicense(maintenance);
  decorateLicense(parent);
}

function findSourcingItemOr404(id) {
  const item = store.sourcingItems.find((i) => i.id === id);
  if (!item) throw new Error("Sourcing item not found");
  return item;
}

function findSourcingRequestOr404(id) {
  const request = store.sourcingRequests.find((r) => r.id === id);
  if (!request) throw new Error("Sourcing request not found");
  return request;
}

function findPendingOrderOr404(id) {
  const order = store.pendingOrders.find((p) => p.id === id);
  if (!order) throw new Error("Pending order not found");
  return order;
}

function findContractOr404(id) {
  const contract = store.contracts.find((c) => c.id === id);
  if (!contract) throw new Error("Contract not found");
  return contract;
}

function findContractFolderOr404(contractId, folderId) {
  const contract = findContractOr404(contractId);
  const folder = (contract.folders ?? []).find((f) => f.id === folderId);
  if (!folder) throw new Error("Folder not found");
  return { contract, folder };
}

function findContractDocumentOr404(contractId, documentId) {
  const document = store.contractDocuments.find(
    (doc) => doc.contractId === contractId && doc.id === documentId
  );
  if (!document) throw new Error("Document not found");
  return document;
}

function buildDemoDownloadResponse(document) {
  const text = `Demo placeholder for ${document.originalFilename}\n`;
  if (typeof Response !== "undefined") {
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${document.originalFilename}"`,
      },
    });
  }
  return { blob: async () => new Blob([text], { type: "text/plain" }) };
}

// Fields a PO line-item update may touch. Mirrors backend/app/schemas/sourcing.py:44-61
// SourcingItemUpdate minus status (the route pops status - pending_order_service.py:188).
const PO_ITEM_UPDATE_FIELDS = [
  "publisherName", "softwareDescription", "licenseType", "maintenanceCoverage",
  "maintenanceStartDate", "maintenanceEndDate", "maintenancePricingBasis",
  "maintenanceQuantity", "maintenanceUnitPrice", "maintenanceCost",
  "quantity", "estimatedUnitPrice", "estimatedTotalPrice",
  "currency", "startDate", "endDate", "supplier", "contactEmail", "notes",
];

export const DEMO_TOAST = "Not available in the demo — this action needs a real deployment.";

export function stubResponse(_method, _pathname) {
  return { data: null, error: DEMO_TOAST };
}

function demoReferenceUsage(reference, kind) {
  const names = new Set([reference.name, ...(reference.aliases || []).map((alias) => alias.name)].map(demoReferenceNormalized));
  const matches = (value) => value && names.has(demoReferenceNormalized(value));
  if (kind === "organization") {
    return {
      licenses: store.licenses.filter((license) => matches(license.publisherName) || matches(license.supplier)).length,
      contracts: store.contracts.filter((contract) => matches(contract.publisherName)).length,
      sourcingRequests: store.sourcingRequests.filter((request) => matches(request.supplier)).length,
      sourcingItems: store.sourcingItems.filter((item) => matches(item.publisherName) || matches(item.supplier)).length,
      pendingOrders: store.pendingOrders.filter((order) => matches(order.supplier)).length,
      total: store.licenses.filter((license) => matches(license.publisherName) || matches(license.supplier)).length
        + store.contracts.filter((contract) => matches(contract.publisherName)).length
        + store.sourcingRequests.filter((request) => matches(request.supplier)).length
        + store.sourcingItems.filter((item) => matches(item.publisherName) || matches(item.supplier)).length
        + store.pendingOrders.filter((order) => matches(order.supplier)).length,
    };
  }
  const assignedViewers = Object.values(store.userDepartments).filter((departments) =>
    departments.some(matches)
  ).length;
  const licenses = store.licenses.filter((license) => matches(license.costCentre)).length;
  return {
    licenses,
    assignedViewers,
    total: licenses + assignedViewers,
  };
}

function demoReferenceResponse(reference, kind) {
  return { ...reference, usage: demoReferenceUsage(reference, kind) };
}

function demoReferenceCollection(kind) {
  return kind === "organization" ? store.organizations : store.costCentres;
}

function demoReferenceOr404(kind, id) {
  const reference = demoReferenceCollection(kind).find((item) => item.id === Number(id));
  if (!reference) throw new Error("Reference not found");
  return reference;
}

function demoReferenceNormalized(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function findDemoReference(kind, value) {
  const normalized = demoReferenceNormalized(value);
  if (!normalized) return null;
  return demoReferenceCollection(kind).find((item) =>
    item.normalizedName === normalized
    || (item.aliases || []).some((alias) => alias.normalizedName === normalized)
  ) || null;
}

function assertDemoReferenceNameAvailable(kind, value, ownerId = null) {
  const owner = findDemoReference(kind, value);
  if (owner && owner.id !== ownerId) throw new Error("A reference with this name or alias already exists");
}

function rewriteDemoReferenceMirrors(kind, previousNames, nextName) {
  const normalizedNames = new Set(previousNames.map(demoReferenceNormalized));
  const replace = (value) => normalizedNames.has(demoReferenceNormalized(value)) ? nextName : value;
  if (kind === "organization") {
    store.licenses.forEach((license) => { license.publisherName = replace(license.publisherName); license.supplier = replace(license.supplier); });
    store.contracts.forEach((contract) => { contract.publisherName = replace(contract.publisherName); });
    store.sourcingItems.forEach((item) => { item.publisherName = replace(item.publisherName); item.supplier = replace(item.supplier); });
    store.sourcingRequests.forEach((item) => { item.supplier = replace(item.supplier); });
    store.pendingOrders.forEach((item) => { item.supplier = replace(item.supplier); });
  } else {
    store.licenses.forEach((license) => { license.costCentre = replace(license.costCentre); });
    for (const [userId, departments] of Object.entries(store.userDepartments)) {
      store.userDepartments[userId] = [...new Set(departments.map(replace))];
    }
  }
}

function renameDemoReference(reference, kind, nextName) {
  const name = nextName.trim();
  const oldName = reference.name;
  const oldNormalized = reference.normalizedName;
  const nextNormalized = demoReferenceNormalized(name);
  assertDemoReferenceNameAvailable(kind, name, reference.id);

  if (nextNormalized !== oldNormalized) {
    reference.aliases = (reference.aliases || []).filter((alias) => alias.normalizedName !== nextNormalized);
    if (!(reference.aliases || []).some((alias) => alias.normalizedName === oldNormalized)) {
      reference.aliases = [...(reference.aliases || []), {
        id: nextId(), name: oldName, normalizedName: oldNormalized, createdAt: new Date().toISOString(),
      }];
    }
  }
  reference.name = name;
  reference.normalizedName = nextNormalized;
  rewriteDemoReferenceMirrors(kind, [oldName, ...(reference.aliases || []).map((alias) => alias.name)], name);
}

function mergeDemoReferences(kind, source, target) {
  const transferredNames = [source.name, ...(source.aliases || []).map((alias) => alias.name)];
  for (const name of transferredNames) {
    const owner = findDemoReference(kind, name);
    if (owner && owner.id !== source.id && owner.id !== target.id) throw new Error(`Cannot merge because ${name} belongs to another reference`);
  }
  if (kind === "organization") {
    target.isPublisher = target.isPublisher || source.isPublisher;
    target.isSupplier = target.isSupplier || source.isSupplier;
  }
  const aliases = [...(target.aliases || [])];
  for (const name of transferredNames) {
    const normalizedName = demoReferenceNormalized(name);
    if (normalizedName === target.normalizedName || aliases.some((alias) => alias.normalizedName === normalizedName)) continue;
    aliases.push({ id: nextId(), name, normalizedName, createdAt: new Date().toISOString() });
  }
  target.aliases = aliases;
  rewriteDemoReferenceMirrors(kind, transferredNames, target.name);
  const collection = demoReferenceCollection(kind);
  if (kind === "organization") store.organizations = collection.filter((item) => item.id !== source.id);
  else store.costCentres = collection.filter((item) => item.id !== source.id);
}

function ensureDemoOrganization(value, role) {
  const name = String(value ?? "").trim();
  if (!name) return null;
  let reference = findDemoReference("organization", name);
  if (reference && !reference.isActive) throw new Error(`${reference.name} is inactive`);
  if (!reference) {
    const now = new Date().toISOString();
    reference = { id: nextId(), name, normalizedName: demoReferenceNormalized(name), isPublisher: false, isSupplier: false, isActive: true, aliases: [], createdAt: now, updatedAt: now };
    store.organizations.push(reference);
  }
  if (role === "publisher") reference.isPublisher = true;
  if (role === "supplier") reference.isSupplier = true;
  return reference;
}

function ensureDemoCostCentre(value) {
  const name = String(value ?? "").trim();
  if (!name) return null;
  let reference = findDemoReference("cost_centre", name);
  if (reference && !reference.isActive) throw new Error(`${reference.name} is inactive`);
  if (!reference) {
    const now = new Date().toISOString();
    reference = { id: nextId(), name, normalizedName: demoReferenceNormalized(name), isActive: true, aliases: [], createdAt: now, updatedAt: now };
    store.costCentres.push(reference);
  }
  return reference;
}

function canonicalizeDemoReferenceFields(payload) {
  const result = { ...(payload || {}) };
  if (Object.hasOwn(result, "publisherName")) result.publisherName = ensureDemoOrganization(result.publisherName, "publisher")?.name || "";
  if (Object.hasOwn(result, "publisher_name")) result.publisher_name = ensureDemoOrganization(result.publisher_name, "publisher")?.name || "";
  if (Object.hasOwn(result, "supplier")) result.supplier = ensureDemoOrganization(result.supplier, "supplier")?.name || null;
  if (Object.hasOwn(result, "costCentre")) result.costCentre = ensureDemoCostCentre(result.costCentre)?.name || null;
  return result;
}

// UserResponse is snake_case - no camelCase alias (backend/app/schemas/user.py:8).
const demoUser = {
  id: 1,
  username: "demo",
  email: "demo@example.com",
  auth_provider: "local",
  role: "admin",
  is_active: true,
  allow_downloads: true,
  is_break_glass_admin: false,
  must_change_password: false,
  created_at: datetimeDaysAgo(120),
};

const demoViewer = {
  ...demoUser,
  id: 2,
  username: "viewer",
  email: "viewer@example.com",
  role: "viewer",
  allow_downloads: false,
};

export const routes = [
  { method: "GET", pattern: /^\/api\/auth\/mode$/, handler: async () => ({ data: { oidc_enabled: false, oidc_available: false }, error: null }) },
  {
    method: "POST", pattern: /^\/api\/auth\/login$/,
    handler: async ({ body }) => {
      if (!body?.username || !body?.password) {
        return { data: null, error: "Enter any username and password — try demo / demo." };
      }
      seedStore();
      return { data: { access_token: "demo-token", token_type: "bearer", user: demoUser }, error: null };
    },
  },
  { method: "POST", pattern: /^\/api\/auth\/logout$/, handler: async () => { resetStore(); return { data: null, error: null }; } },
  { method: "GET", pattern: /^\/api\/auth\/session$/, handler: async () => ({ data: { authenticated: store.seeded, user: store.seeded ? demoUser : null }, error: null }) },
  { method: "GET", pattern: /^\/api\/users\/me$/, handler: async () => ({ data: demoUser, error: null }) },
  { method: "GET", pattern: /^\/api\/users$/, handler: async () => ({ data: [demoUser, demoViewer], error: null }) },
  {
    method: "GET", pattern: /^\/api\/users\/(?<id>\d+)\/departments$/,
    handler: async ({ params }) => {
      const userId = Number(params.id);
      if (![demoUser.id, demoViewer.id].includes(userId)) throw new Error("User not found");
      return { data: store.userDepartments[userId] || [], error: null };
    },
  },
  {
    method: "PUT", pattern: /^\/api\/users\/(?<id>\d+)\/departments$/,
    handler: async ({ params, body }) => {
      const userId = Number(params.id);
      if (![demoUser.id, demoViewer.id].includes(userId)) throw new Error("User not found");
      const current = new Set((store.userDepartments[userId] || []).map(demoReferenceNormalized));
      const departments = [];
      for (const requestedName of body?.departments || []) {
        const reference = findDemoReference("cost_centre", requestedName);
        if (!reference) throw new Error(`Unknown department: ${requestedName}`);
        if (!reference.isActive && !current.has(reference.normalizedName)) throw new Error(`${reference.name} is inactive`);
        if (!departments.includes(reference.name)) departments.push(reference.name);
      }
      store.userDepartments[userId] = departments;
      return { data: departments, error: null };
    },
  },

  // Quiet read-only endpoints used by top-level pages and Admin tabs.
  // Side-effect endpoints stay unregistered and therefore show DEMO_TOAST.

  { method: "GET", pattern: /^\/api\/notifications$/, handler: async () => ({ data: computeNotifications(), error: null }) },
  { method: "GET", pattern: /^\/api\/reports\/detailed$/, handler: async ({ query }) => ({ data: buildDemoDetailedReport(query), error: null }) },
  { method: "GET", pattern: /^\/api\/reports\/detailed\/export$/, handler: async ({ query }) => ({ data: new Response(buildDemoReportCsv(query), { headers: { "Content-Type": "text/csv" } }), error: null }) },
  { method: "GET", pattern: /^\/api\/reports\/portfolio-stats$/, handler: async () => ({ data: computePortfolioReportStats(), error: null }) },
  { method: "GET", pattern: /^\/api\/extensions\/capabilities$/, handler: async () => ({ data: [], error: null }) },
  { method: "GET", pattern: /^\/api\/custom-fields\/?$/, handler: async () => ({ data: [], error: null }) },
  { method: "GET", pattern: /^\/api\/api-tokens$/, handler: async () => ({ data: [], error: null }) },
  { method: "GET", pattern: /^\/api\/webhooks$/, handler: async () => ({ data: [], error: null }) },
  { method: "GET", pattern: /^\/api\/backup\/list$/, handler: async () => ({ data: [], error: null }) },
  { method: "GET", pattern: /^\/api\/audit-log$/, handler: async () => ({ data: { results: [], total: 0 }, error: null }) },

  // Reference-data management - mirrors the admin API in an isolated demo store.
  {
    method: "GET", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)$/,
    handler: async ({ params, query }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const search = demoReferenceNormalized(query.get("search") || "");
      const active = query.get("active");
      const role = query.get("role");
      const data = demoReferenceCollection(kind)
        .filter((item) => !search || demoReferenceNormalized(item.name).includes(search) || (item.aliases || []).some((alias) => demoReferenceNormalized(alias.name).includes(search)))
        .filter((item) => active == null || String(item.isActive) === active)
        .filter((item) => kind !== "organization" || !role || (role === "publisher" ? item.isPublisher : item.isSupplier))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => demoReferenceResponse(item, kind));
      return { data, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)$/,
    handler: async ({ params, body }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const name = String(body?.name || "").trim();
      if (!name) throw new Error("Name is required");
      const collection = demoReferenceCollection(kind);
      assertDemoReferenceNameAvailable(kind, name);
      if (kind === "organization" && !body?.isPublisher && !body?.isSupplier) throw new Error("At least one organization role is required");
      const item = kind === "organization"
        ? { id: nextId(), name, normalizedName: demoReferenceNormalized(name), isPublisher: !!body.isPublisher, isSupplier: !!body.isSupplier, isActive: true, aliases: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : { id: nextId(), name, normalizedName: demoReferenceNormalized(name), isActive: true, aliases: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      collection.push(item);
      return { data: demoReferenceResponse(item, kind), error: null };
    },
  },
  {
    method: "PATCH", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const item = demoReferenceOr404(kind, params.id);
      let nextPublisher;
      let nextSupplier;
      if (kind === "organization") {
        nextPublisher = body?.isPublisher ?? item.isPublisher;
        nextSupplier = body?.isSupplier ?? item.isSupplier;
        if (!nextPublisher && !nextSupplier) throw new Error("At least one organization role is required");
        const names = new Set([item.name, ...(item.aliases || []).map((alias) => alias.name)].map(demoReferenceNormalized));
        const matches = (value) => names.has(demoReferenceNormalized(value));
        if (item.isPublisher && !nextPublisher && (
          store.licenses.some((license) => matches(license.publisherName))
          || store.contracts.some((contract) => matches(contract.publisherName))
          || store.sourcingItems.some((sourcingItem) => matches(sourcingItem.publisherName))
        )) throw new Error("Publisher role cannot be removed while it is in use");
        if (item.isSupplier && !nextSupplier && (
          store.licenses.some((license) => matches(license.supplier))
          || store.sourcingRequests.some((request) => matches(request.supplier))
          || store.sourcingItems.some((sourcingItem) => matches(sourcingItem.supplier))
          || store.pendingOrders.some((order) => matches(order.supplier))
        )) throw new Error("Supplier role cannot be removed while it is in use");
      }
      if (Object.hasOwn(body || {}, "name")) {
        const name = String(body.name || "").trim();
        if (!name) throw new Error("Name is required");
        renameDemoReference(item, kind, name);
      }
      if (kind === "organization") {
        item.isPublisher = nextPublisher;
        item.isSupplier = nextSupplier;
      }
      item.updatedAt = new Date().toISOString();
      return { data: demoReferenceResponse(item, kind), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)\/(?<action>activate|deactivate)$/,
    handler: async ({ params }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const item = demoReferenceOr404(kind, params.id);
      item.isActive = params.action === "activate";
      return { data: demoReferenceResponse(item, kind), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)\/aliases$/,
    handler: async ({ params, body }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const item = demoReferenceOr404(kind, params.id);
      const name = String(body?.name || "").trim();
      if (!name) throw new Error("Alias name is required");
      if (findDemoReference(kind, name)) throw new Error("This name or alias already exists");
      item.aliases = [...(item.aliases || []), { id: nextId(), name, normalizedName: demoReferenceNormalized(name), createdAt: new Date().toISOString() }];
      return { data: demoReferenceResponse(item, kind), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)\/aliases\/(?<aliasId>\d+)$/,
    handler: async ({ params }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const item = demoReferenceOr404(kind, params.id);
      item.aliases = (item.aliases || []).filter((alias) => alias.id !== Number(params.aliasId));
      return { data: null, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)\/merge-preview$/,
    handler: async ({ params, query }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const source = demoReferenceOr404(kind, params.id);
      const target = demoReferenceOr404(kind, query.get("target_id"));
      if (source.id === target.id) throw new Error("A reference cannot be merged into itself");
      if (!target.isActive) throw new Error("The merge target must be active");
      return { data: { sourceId: source.id, sourceName: source.name, targetId: target.id, targetName: target.name, sourceUsage: demoReferenceUsage(source, kind) }, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)\/merge$/,
    handler: async ({ params, body }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const source = demoReferenceOr404(kind, params.id);
      const target = demoReferenceOr404(kind, body?.targetId);
      if (source.id === target.id) throw new Error("A reference cannot be merged into itself");
      if (!target.isActive) throw new Error("The merge target must be active");
      const affected = demoReferenceUsage(source, kind);
      mergeDemoReferences(kind, source, target);
      return { data: { sourceId: source.id, targetId: target.id, targetName: target.name, affected }, error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/reference-data\/(?<kind>organizations|cost-centres)\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const kind = params.kind === "organizations" ? "organization" : "cost_centre";
      const item = demoReferenceOr404(kind, params.id);
      if ((demoReferenceUsage(item, kind).total ?? 0) > 0) throw new Error("This reference is still in use");
      const collection = demoReferenceCollection(kind).filter((candidate) => candidate.id !== item.id);
      if (kind === "organization") store.organizations = collection;
      else store.costCentres = collection;
      return { data: null, error: null };
    },
  },

  // Contracts - in-memory records, folders, document metadata and linked
  // license lookup. Uploads/downloads are browser-local demo placeholders:
  // no backend calls and no file storage.

  {
    method: "GET", pattern: /^\/api\/contracts$/,
    handler: async () => ({
      data: store.contracts
        .slice()
        .sort((a, b) => a.publisherName.localeCompare(b.publisherName))
        .map(buildContractResponse),
      error: null,
    }),
  },
  {
    method: "POST", pattern: /^\/api\/contracts$/,
    handler: async ({ body }) => {
      const contractNumber = body?.contract_number?.trim();
      const requestedPublisher = body?.publisher_name?.trim();
      if (!contractNumber || !requestedPublisher) {
        throw new Error("Contract number and publisher name are required.");
      }
      const publisherName = ensureDemoOrganization(requestedPublisher, "publisher").name;
      const now = new Date().toISOString();
      const contract = {
        id: nextId(),
        contractNumber,
        publisherName,
        notes: body?.notes ?? null,
        createdAt: now,
        createdBy: 1,
        folders: [],
      };
      store.contracts.push(contract);
      return { data: buildContractResponse(contract), error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/contracts\/(?<id>\d+)$/,
    handler: async ({ params }) => ({
      data: buildContractResponse(findContractOr404(Number(params.id))),
      error: null,
    }),
  },
  {
    method: "PUT", pattern: /^\/api\/contracts\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const contract = findContractOr404(Number(params.id));
      const oldContractNumber = contract.contractNumber;
      if (body?.contract_number != null) contract.contractNumber = body.contract_number.trim();
      if (body?.publisher_name != null) contract.publisherName = ensureDemoOrganization(body.publisher_name, "publisher")?.name || "";
      if (Object.hasOwn(body ?? {}, "notes")) contract.notes = body.notes ?? null;
      renameContractNumberOnLicenses(oldContractNumber, contract.contractNumber);
      return { data: buildContractResponse(contract), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/contracts\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      findContractOr404(id);
      store.contracts = store.contracts.filter((contract) => contract.id !== id);
      store.contractDocuments = store.contractDocuments.filter((doc) => doc.contractId !== id);
      return { data: null, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/contracts\/(?<id>\d+)\/licenses$/,
    handler: async ({ params }) => {
      const contract = findContractOr404(Number(params.id));
      return { data: buildContractLicenseRows(contract), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/contracts\/(?<id>\d+)\/folders$/,
    handler: async ({ params, body }) => {
      const contract = findContractOr404(Number(params.id));
      const name = body?.name?.trim();
      if (!name) throw new Error("Folder name is required");
      const folder = {
        id: nextId(),
        name,
        createdAt: new Date().toISOString(),
        documentCount: 0,
      };
      contract.folders = [...(contract.folders ?? []), folder];
      return { data: folder, error: null };
    },
  },
  {
    method: "PUT", pattern: /^\/api\/contracts\/(?<id>\d+)\/folders\/(?<folderId>\d+)$/,
    handler: async ({ params, body }) => {
      const contractId = Number(params.id);
      const folderId = Number(params.folderId);
      const { folder } = findContractFolderOr404(contractId, folderId);
      const name = body?.name?.trim();
      if (!name) throw new Error("Folder name is required");
      folder.name = name;
      folder.documentCount = store.contractDocuments.filter((doc) => doc.folderId === folderId).length;
      return { data: folder, error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/contracts\/(?<id>\d+)\/folders\/(?<folderId>\d+)$/,
    handler: async ({ params }) => {
      const contractId = Number(params.id);
      const folderId = Number(params.folderId);
      const { contract } = findContractFolderOr404(contractId, folderId);
      const docCount = store.contractDocuments.filter((doc) => doc.folderId === folderId).length;
      if (docCount > 0) {
        throw new Error("Cannot delete a folder that contains documents. Remove all documents first.");
      }
      contract.folders = contract.folders.filter((folder) => folder.id !== folderId);
      return { data: null, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/contracts\/(?<id>\d+)\/documents$/,
    handler: async ({ params }) => {
      const contractId = Number(params.id);
      findContractOr404(contractId);
      return {
        data: store.contractDocuments
          .filter((doc) => doc.contractId === contractId)
          .map((doc) => ({ ...doc, fileAvailability: doc.fileAvailability ?? "available" })),
        error: null,
      };
    },
  },
  {
    method: "POST", pattern: /^\/api\/contracts\/(?<id>\d+)\/documents$/,
    handler: async ({ params, formData }) => {
      const contractId = Number(params.id);
      findContractOr404(contractId);
      const file = formData?.get("file");
      const filename = file?.name || "demo-upload.txt";
      const document = {
        id: nextId(),
        contractId,
        folderId: null,
        filename: `contracts/${contractId}/${filename}`,
        originalFilename: filename,
        fileSize: file?.size ?? null,
        createdAt: new Date().toISOString(),
        fileAvailability: "available",
      };
      store.contractDocuments.push(document);
      return { data: document, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/contracts\/(?<id>\d+)\/folders\/(?<folderId>\d+)\/documents$/,
    handler: async ({ params, formData }) => {
      const contractId = Number(params.id);
      const folderId = Number(params.folderId);
      findContractFolderOr404(contractId, folderId);
      const file = formData?.get("file");
      const filename = file?.name || "demo-upload.txt";
      const document = {
        id: nextId(),
        contractId,
        folderId,
        filename: `contracts/${contractId}/${filename}`,
        originalFilename: filename,
        fileSize: file?.size ?? null,
        createdAt: new Date().toISOString(),
        fileAvailability: "available",
      };
      store.contractDocuments.push(document);
      return { data: document, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/contracts\/(?<id>\d+)\/documents\/(?<documentId>\d+)\/download$/,
    handler: async ({ params }) => {
      const document = findContractDocumentOr404(Number(params.id), Number(params.documentId));
      return { data: buildDemoDownloadResponse(document), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/contracts\/(?<id>\d+)\/documents\/(?<documentId>\d+)$/,
    handler: async ({ params }) => {
      const contractId = Number(params.id);
      const documentId = Number(params.documentId);
      findContractDocumentOr404(contractId, documentId);
      store.contractDocuments = store.contractDocuments.filter(
        (doc) => !(doc.contractId === contractId && doc.id === documentId)
      );
      return { data: null, error: null };
    },
  },

  // Settings - in-memory demo persistence for harmless app preferences.
  // Refresh/logout resets these values; external side-effect actions remain
  // unregistered and fall through to the standard demo-only warning.

  {
    method: "GET", pattern: /^\/api\/settings$/,
    handler: async () => ({ data: store.userSettings, error: null }),
  },
  {
    method: "PUT", pattern: /^\/api\/settings$/,
    handler: async ({ body }) => {
      store.userSettings = { ...store.userSettings, ...(body ?? {}) };
      return { data: store.userSettings, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/settings\/global$/,
    handler: async () => ({ data: store.globalSettings, error: null }),
  },
  {
    method: "PUT", pattern: /^\/api\/settings\/global$/,
    handler: async ({ body }) => {
      store.globalSettings = { ...store.globalSettings, ...(body ?? {}) };
      return { data: store.globalSettings, error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/settings\/global\/public$/,
    handler: async () => ({
      data: {
        mandatory_fields: store.globalSettings.mandatory_fields,
        notification_days: store.globalSettings.notification_days,
        oidc_enabled: store.globalSettings.oidc_enabled,
        oidc_available: store.globalSettings.oidc_available,
      },
      error: null,
    }),
  },

  // Licenses - specific routes registered before the generic /{id} routes so
  // they match first (the router takes the first regex match in this array).

  {
    method: "GET", pattern: /^\/api\/renewals\/workbench$/,
    handler: async ({ query }) => ({
      data: buildRenewalWorkbenchRows({
        windowDays: query.get("window_days") ?? 90,
        view: query.get("view") ?? "all",
      }),
      error: null,
    }),
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/stats$/,
    handler: async () => ({ data: computeStats(), error: null }),
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/departments$/,
    handler: async () => ({ data: computeDepartments(), error: null }),
  },
  {
    method: "DELETE", pattern: /^\/api\/licenses\/bulk$/,
    handler: async ({ body }) => {
      const ids = new Set((body?.ids ?? []).map(Number));
      const before = store.licenses.length;
      store.licenses = store.licenses.filter((l) => !ids.has(l.id));
      return { data: { deleted: before - store.licenses.length }, error: null };
    },
  },
  {
    // Mirrors backend/app/services/renewal_orchestrator.py:45-79 + renewal_workflow.py:75-98.
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/initiate-renewal$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      const license = findLicenseOr404(id);

      if (license.lifecycleStatus === "pending_renewal") {
        throw new Error("Renewal already initiated for this license");
      }
      if (license.lifecycleStatus === "renewed") {
        throw new Error("License has already been renewed");
      }
      if (license.renewedToId != null) {
        throw new Error(`License ${license.id} has already been renewed`);
      }
      if (license.endDate == null) {
        throw new Error("Cannot initiate renewal on a perpetual license (no end date)");
      }

      license.lifecycleStatus = "pending_renewal";
      decorateLicense(license);

      const now = new Date().toISOString();
      const qty = license.quantity || null;
      const unitPrice = license.unitPrice || null;
      const lineTotal =
        qty && unitPrice ? (Number(qty) * Number(unitPrice)).toFixed(2) : null;
      const sourcingItem = {
        id: nextId(),
        sourcingRequestId: null,
        publisherName: license.publisherName,
        softwareDescription: license.softwareDescription,
        licenseType: license.licenseType,
        licenseMetric: license.licenseMetric,
        portalUrl: license.portalUrl ?? null,
        quantity: qty,
        quantityPerUnit: license.quantityPerUnit || "1",
        skuCode: license.skuCode || null,
        estimatedUnitPrice: unitPrice,
        estimatedTotalPrice: lineTotal,
        currency: license.currency,
        startDate: null,
        endDate: null,
        supplier: license.supplier || null,
        contactEmail: license.contactEmail || null,
        contractNumber: license.contractNumber || null,
        externalRef: null,
        costCentre: license.costCentre || null,
        budgetOwnerEmail: license.budgetOwnerEmail || null,
        secondaryContacts: [...(license.secondaryContacts || [])],
        customFieldValues: [],
        notes: null,
        status: "sourcing",
        pendingOrderId: null,
        renewalForLicenseId: license.id,
        cotermPredecessorIds: null,
        isRenewal: true,
        createdAt: now,
        updatedAt: now,
        createdBy: 1,
      };
      ensureSourcingRequestForItem(sourcingItem);
      store.sourcingItems.push(sourcingItem);

      return { data: { license: withComputedCompleteness(license), sourcingItem }, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/licenses\/renewal-bundle\/initiate$/,
    handler: async ({ body }) => ({ data: initiateRenewalBundleRecord(body?.licenseIds ?? []), error: null }),
  },
  {
    // Mirrors backend/app/services/renewal_orchestrator.py cancel_renewal.
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/cancel-renewal$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      const license = findLicenseOr404(id);

      if (license.lifecycleStatus !== "pending_renewal") {
        throw new Error("License is not in pending_renewal status");
      }

      const now = new Date().toISOString();
      const sourcingOnlyItems = store.sourcingItems.filter(
        (s) => s.status === "sourcing" && sourcingItemPredecessorIds(s).includes(id)
      );
      for (const item of sourcingOnlyItems) {
        if (item.sourcingRequestId == null) {
          ensureSourcingRequestForItem(item);
        }
      }
      const requestIds = [...new Set(sourcingOnlyItems.map((item) => item.sourcingRequestId).filter(Boolean))];
      for (const requestId of requestIds) {
        const request = findSourcingRequestOr404(requestId);
        if (request.status !== "sourcing") {
          throw new Error(`Cannot modify a ${request.status} sourcing request`);
        }
        const renewalIds = new Set();
        request.status = "cancelled";
        request.updatedAt = now;
        for (const item of store.sourcingItems.filter((candidate) => candidate.sourcingRequestId === request.id)) {
          if (item.status === "sourcing") {
            for (const predecessorId of sourcingItemPredecessorIds(item)) renewalIds.add(predecessorId);
            item.status = "cancelled";
            item.updatedAt = now;
          }
        }
        for (const renewalLicenseId of renewalIds) {
          handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId: null });
        }
      }
      const poWarning = store.sourcingItems.some(
        (s) => s.status === "converted" && sourcingItemPredecessorIds(s).includes(id)
      );

      if (license.lifecycleStatus === "pending_renewal") {
        license.lifecycleStatus = null;
        decorateLicense(license);
      }

      return { data: { license: withComputedCompleteness(license), poWarning }, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/license_maintenance.py:51-102 +
    // backend/app/services/maintenance_service.py:160-184 (disable_maintenance_for_parent
    // is a no-op unless activeMaintenanceId is set).
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/disable-maintenance$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      const license = findLicenseOr404(id);

      if (!MAINTENANCE_PARENT_TYPES.has(license.licenseType)) {
        throw new Error(
          "Maintenance/support tracking can only be disabled on perpetual, OEM, or freeware Licenses."
        );
      }
      if (!license.hasMaintenance || license.activeMaintenanceId == null) {
        return { data: withComputedCompleteness(license), error: null };
      }

      const child = store.licenses.find((l) => l.id === license.activeMaintenanceId);
      if (child) {
        child.maintenanceParentIds = (child.maintenanceParentIds || []).filter(
          (parentId) => Number(parentId) !== Number(license.id)
        );
        if (Number(child.parentLicenseId) === Number(license.id)) {
          child.parentLicenseId = child.maintenanceParentIds[0] ?? null;
        }
        if (child.maintenanceParentIds.length === 0) {
          child.isRetired = true;
        }
        decorateLicense(child);
      }
      license.linkedMaintenanceIds = (license.linkedMaintenanceIds || []).filter(
        (maintenanceId) => Number(maintenanceId) !== Number(license.activeMaintenanceId)
      );
      license.activeMaintenanceId = null;
      license.hasMaintenance = false;
      license.maintenanceStartDate = null;
      license.maintenanceEndDate = null;
      license.maintenancePricingBasis = null;
      license.maintenanceQuantity = null;
      license.maintenanceUnitPrice = null;
      license.maintenanceCost = null;
      decorateLicense(license);

      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/link-maintenance$/,
    handler: async ({ params, body }) => {
      const parent = findLicenseOr404(Number(params.id));
      const maintenance = findLicenseOr404(Number(body?.maintenanceLicenseId));
      linkMaintenanceToParentRecord(maintenance, parent);
      return { data: withComputedCompleteness(parent), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/po-total-override$/,
    handler: async ({ params, body }) => {
      const license = findLicenseOr404(Number(params.id));
      if (!license.poNumber) throw new Error("A PO number is required to override the total PO value");
      const value = body?.poTotalOverride;
      if (!value) throw new Error("PO total override is required");
      store.licenses
        .filter((item) => item.poNumber === license.poNumber && item.currency === license.currency)
        .forEach((item) => { item.poTotalOverride = value; decorateLicense(item); });
      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/licenses\/(?<id>\d+)\/po-total-override$/,
    handler: async ({ params }) => {
      const license = findLicenseOr404(Number(params.id));
      if (!license.poNumber) throw new Error("A PO number is required to clear the total PO override");
      store.licenses
        .filter((item) => item.poNumber === license.poNumber && item.currency === license.currency)
        .forEach((item) => { item.poTotalOverride = null; decorateLicense(item); });
      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    // Mirrors backend/app/services/license_write_service.py:276-314.
    method: "PATCH", pattern: /^\/api\/licenses\/(?<id>\d+)\/field$/,
    handler: async ({ params, body }) => {
      const id = Number(params.id);
      const license = findLicenseOr404(id);
      const { field, value } = body ?? {};

      if (!FIELD_PATCH_ALLOWED.has(field)) {
        throw new Error(`Field '${field}' is not allowed. Allowed: ${[...FIELD_PATCH_ALLOWED].join(", ")}`);
      }

      let resolvedValue = value;
      if (field === "publisherName") resolvedValue = ensureDemoOrganization(value, "publisher")?.name || "";
      if (field === "supplier") resolvedValue = ensureDemoOrganization(value, "supplier")?.name || null;
      if (field === "costCentre") resolvedValue = ensureDemoCostCentre(value)?.name || null;

      if (field === "contractNumber") {
        license.contractNumber = value || "";
      } else if (DATE_PATCH_FIELDS.has(field)) {
        license[field] = value || null;
      } else {
        license[field] = resolvedValue;
      }
      decorateLicense(license);

      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/(?<id>\d+)\/custom-fields\/?$/,
    handler: async () => ({ data: { values: [] }, error: null }),
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/(?<id>\d+)\/documents$/,
    handler: async () => ({ data: [], error: null }),
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/(?<id>\d+)\/procurement-trail$/,
    handler: async ({ params }) => ({ data: buildLicenseProcurementTrail(findLicenseOr404(Number(params.id))), error: null }),
  },
  {
    method: "POST", pattern: /^\/api\/licenses\/(?<id>\d+)\/documents$/,
    handler: async () => stubResponse("POST", "documents"),
  },
  {
    method: "GET", pattern: /^\/api\/custom-fields\/values$/,
    handler: async () => ({ data: { values: [] }, error: null }),
  },

  // Licenses - generic CRUD (must come after all the specific routes above).

  {
    method: "GET", pattern: /^\/api\/licenses$/,
    handler: async ({ query }) => {
      const includeRetired = query.get("include_retired") === "true";
      const parentLicenseId = query.get("parent_license_id");
      let result = store.licenses;
      if (!includeRetired) result = result.filter((l) => !l.isRetired);
      if (parentLicenseId !== null) {
        const parentId = Number(parentLicenseId);
        result = result.filter((l) => hasMaintenanceParent(l, parentId));
      }
      return { data: result.map(withComputedCompleteness), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/licenses\/batch$/,
    handler: async ({ body }) => {
      const pending = [];
      for (const item of body?.items ?? []) {
        const parentLineIndex = item.parentLineIndex;
        if (parentLineIndex != null && (parentLineIndex < 0 || parentLineIndex >= pending.length)) {
          throw new Error("parentLineIndex must refer to an earlier item in the same batch.");
        }
        const now = new Date().toISOString();
        const id = nextId();
        const license = buildLicense({
          ...canonicalizeDemoReferenceFields(item.license),
          ...(parentLineIndex == null ? {} : { parentLicenseId: pending[parentLineIndex].id }),
          id,
          licenseRef: `LT-2026-${String(id).padStart(4, "0")}`,
          createdAt: now,
          updatedAt: now,
        });
        if (license.licenseType === "maintenance") {
          const parentIds = [
            license.parentLicenseId,
            ...(license.maintenanceParentIds || []),
          ].filter((parentId, parentIdIndex, ids) => parentId != null && ids.indexOf(parentId) === parentIdIndex);
          for (const parentId of parentIds) {
            const parent = pending.find((l) => Number(l.id) === Number(parentId)) ||
              store.licenses.find((l) => Number(l.id) === Number(parentId));
            if (parent) linkMaintenanceToParentRecord(license, parent);
          }
        }
        pending.push(license);
      }
      store.licenses.push(...pending);
      return { data: pending.map(withComputedCompleteness), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/licenses$/,
    handler: async ({ body }) => {
      const now = new Date().toISOString();
      const id = nextId();
      const license = buildLicense({
        ...canonicalizeDemoReferenceFields(body),
        id,
        // Real backend always generates an LT-Ref on create (routes/licenses.py:179)
        licenseRef: `LT-2026-${String(id).padStart(4, "0")}`,
        createdAt: now,
        updatedAt: now,
      });
      store.licenses.push(license);
      if (license.licenseType === "maintenance") {
        const parentIds = [
          license.parentLicenseId,
          ...(license.maintenanceParentIds || []),
        ].filter((parentId, index, ids) => parentId != null && ids.indexOf(parentId) === index);
        for (const parentId of parentIds) {
          const parent = store.licenses.find((l) => Number(l.id) === Number(parentId));
          if (parent) linkMaintenanceToParentRecord(license, parent);
        }
      }
      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    method: "GET", pattern: /^\/api\/licenses\/(?<id>\d+)$/,
    handler: async ({ params }) => ({ data: withComputedCompleteness(findLicenseOr404(Number(params.id))), error: null }),
  },
  {
    method: "PUT", pattern: /^\/api\/licenses\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const license = findLicenseOr404(Number(params.id));
      Object.assign(license, canonicalizeDemoReferenceFields(body));
      decorateLicense(license);
      return { data: withComputedCompleteness(license), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/licenses\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      const idx = store.licenses.findIndex((l) => l.id === id);
      if (idx === -1) throw new Error("License not found");
      store.licenses.splice(idx, 1);
      return { data: null, error: null };
    },
  },

  // Sourcing - specific routes registered before the generic /{id} routes.
  // Mirrors backend/app/routes/sourcing.py, sourcing_items.py, sourcing_requests.py,
  // sourcing_conversion.py (verified 2026-07-10). Quote-document upload/download
  // and CSV export routes are intentionally left unregistered (stub toast).

  {
    method: "GET", pattern: /^\/api\/sourcing\/requests\/history$/,
    handler: async () => ({
      data: store.sourcingRequests
        .filter((request) => ["converted", "cancelled"].includes(request.status))
        .slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(buildSourcingRequestResponse),
      error: null,
    }),
  },
  {
    // Mirrors backend/app/services/sourcing_service.py:136-147 list_sourcing_request_records
    // (backfills a SourcingRequest for any orphaned item first, then lists status="sourcing").
    method: "GET", pattern: /^\/api\/sourcing\/requests$/,
    handler: async () => {
      backfillMissingSourcingRequests();
      const requests = store.sourcingRequests
        .filter((r) => r.status === "sourcing")
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(buildSourcingRequestResponse);
      return { data: requests, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_requests.py:40-61 create_sourcing_request.
    method: "POST", pattern: /^\/api\/sourcing\/requests$/,
    handler: async ({ body }) => {
      if ((body?.items ?? []).length === 0) {
        throw new Error("At least one sourcing item is required");
      }
      const requestPayload = canonicalizeDemoReferenceFields(body);
      const itemPayloads = body.items.map(canonicalizeDemoReferenceFields);
      let requestSupplier = cleanProcurementIdentity(requestPayload.supplier);
      let requestContact = cleanProcurementIdentity(body?.contactEmail);
      for (const itemPayload of itemPayloads.filter((item) => item.parentItemIndex == null)) {
        const itemSupplier = cleanProcurementIdentity(itemPayload.supplier);
        const itemContact = cleanProcurementIdentity(itemPayload.contactEmail);
        if (requestSupplier && itemSupplier && !procurementIdentitiesMatch(requestSupplier, itemSupplier)) {
          throw new Error("All lines in a sourcing request must use the same request supplier");
        }
        if (requestContact && itemContact && !procurementIdentitiesMatch(requestContact, itemContact)) {
          throw new Error("All lines in a sourcing request must use the same supplier contact");
        }
        requestSupplier ||= itemSupplier;
        requestContact ||= itemContact;
      }
      const now = new Date().toISOString();
      const request = {
        id: nextId(),
        supplier: requestSupplier,
        contactEmail: requestContact,
        notes: requestPayload.notes ?? null,
        status: "sourcing",
        createdAt: now,
        updatedAt: now,
        createdBy: 1,
      };
      store.sourcingRequests.push(request);
      const createdItems = [];
      for (const itemPayload of itemPayloads) {
        let targetRequest = request;
        const parentItem = itemPayload.parentItemIndex != null
          ? createdItems[itemPayload.parentItemIndex]
          : null;
        const childSupplier = cleanProcurementIdentity(itemPayload.supplier) || request.supplier;
        if (parentItem && childSupplier && !procurementIdentitiesMatch(childSupplier, request.supplier)) {
          targetRequest = {
            ...request,
            id: nextId(),
            supplier: childSupplier,
            contactEmail: cleanProcurementIdentity(itemPayload.contactEmail) || request.contactEmail,
          };
          store.sourcingRequests.push(targetRequest);
        } else if (
          parentItem
          && itemPayload.contactEmail
          && !procurementIdentitiesMatch(itemPayload.contactEmail, request.contactEmail)
        ) {
          throw new Error("All lines in a sourcing request must use the same supplier contact");
        }
        const item = buildSourcingItem({
          ...itemPayload,
          supplier: targetRequest.supplier,
          contactEmail: targetRequest.contactEmail,
          parentSourcingItemId: parentItem?.id ?? itemPayload.parentSourcingItemId,
        }, { sourcingRequestId: targetRequest.id });
        store.sourcingItems.push(item);
        createdItems.push(item);
      }
      return { data: buildSourcingRequestResponse(request), error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_requests.py:129-157 add_sourcing_request_item.
    method: "POST", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)\/items$/,
    handler: async ({ params, body }) => {
      const request = findSourcingRequestOr404(Number(params.id));
      if (request.status === "converted") {
        throw new Error("Cannot add items to a converted sourcing request");
      }
      const itemPayload = canonicalizeDemoReferenceFields(body);
      const proposedSupplier = cleanProcurementIdentity(itemPayload.supplier);
      const proposedContact = cleanProcurementIdentity(body?.contactEmail);
      if (request.supplier && proposedSupplier && !procurementIdentitiesMatch(request.supplier, proposedSupplier)) {
        throw new Error("The line supplier conflicts with the sourcing request supplier");
      }
      if (request.contactEmail && proposedContact && !procurementIdentitiesMatch(request.contactEmail, proposedContact)) {
        throw new Error("The line contact conflicts with the sourcing request contact");
      }
      if (!request.supplier && proposedSupplier) {
        synchronizeOpenSourcingRequestIdentity(request, {
          supplier: proposedSupplier,
          ...(proposedContact ? { contactEmail: proposedContact } : {}),
        });
      } else if (!request.contactEmail && proposedContact) {
        synchronizeOpenSourcingRequestIdentity(request, { contactEmail: proposedContact });
      }
      store.sourcingItems.push(buildSourcingItem({
        ...itemPayload,
        supplier: request.supplier,
        contactEmail: request.contactEmail,
      }, { sourcingRequestId: request.id, status: "sourcing" }));
      return { data: buildSourcingRequestResponse(request), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)\/cancel$/,
    handler: async ({ params }) => {
      const request = findSourcingRequestOr404(Number(params.id));
      if (request.status !== "sourcing") {
        throw new Error(`Cannot modify a ${request.status} sourcing request`);
      }
      const now = new Date().toISOString();
      const renewalIds = new Set();
      request.status = "cancelled";
      request.updatedAt = now;
      for (const item of store.sourcingItems.filter((candidate) => candidate.sourcingRequestId === request.id)) {
        if (item.status === "sourcing") {
          for (const predecessorId of sourcingItemPredecessorIds(item)) renewalIds.add(predecessorId);
          item.status = "cancelled";
          item.updatedAt = now;
        }
      }
      for (const renewalLicenseId of renewalIds) {
        handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId: null });
      }
      return { data: buildSourcingRequestResponse(request), error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)\/convert-freeware$/,
    handler: async ({ params }) => {
      const request = findSourcingRequestOr404(Number(params.id));
      const items = store.sourcingItems.filter(
        (item) => item.sourcingRequestId === request.id && item.status === "sourcing"
      );
      if (items.some((item) => (
        item.licenseType !== "freeware"
        || (item.maintenanceCoverage === "included" && Number(item.maintenanceCost) > 0)
      ))) {
        throw new Error("Convert purchase lines to a pending order before converting this request directly");
      }
      return { data: convertFreewareSourcingItems(items), error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_conversion.py:29-77 convert_sourcing_request.
    method: "POST", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)\/convert$/,
    handler: async ({ params, body }) => {
      const request = findSourcingRequestOr404(Number(params.id));
      const conversion = canonicalizeDemoReferenceFields(body);
      const order = convertSourcingRequestToOrder(request, {
        pendingOrderId: conversion.pendingOrderId ?? null,
        poNumber: conversion.poNumber ?? null,
        supplier: conversion.supplier ?? null,
        notes: conversion.notes ?? null,
      });
      return { data: order, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_requests.py:74-104 update_sourcing_request.
    // No "already converted" guard on the backend route - mirrored faithfully.
    method: "PUT", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const request = findSourcingRequestOr404(Number(params.id));
      const requestPayload = canonicalizeDemoReferenceFields(body);
      synchronizeOpenSourcingRequestIdentity(request, {
        ...(body && Object.prototype.hasOwnProperty.call(body, "supplier") ? { supplier: requestPayload.supplier } : {}),
        ...(body && Object.prototype.hasOwnProperty.call(body, "contactEmail")
          ? { contactEmail: body.contactEmail }
          : {}),
      });
      if (body && Object.prototype.hasOwnProperty.call(body, "notes")) request.notes = body.notes;
      request.updatedAt = new Date().toISOString();
      return { data: buildSourcingRequestResponse(request), error: null };
    },
  },
  {
    // Mirrors backend/app/services/sourcing_service.py:212-225 delete_sourcing_request_record
    // (cascade="all, delete-orphan" on SourcingRequest.items - see models/sourcing.py:36-41
    // deletes child items too; only the renewal-cleanup side effect runs, no orphaned-PO cleanup).
    method: "DELETE", pattern: /^\/api\/sourcing\/requests\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      findSourcingRequestOr404(id);
      const items = store.sourcingItems.filter((i) => i.sourcingRequestId === id);
      if (items.some((item) => item.status === "converted")) {
        throw new Error("Cannot delete a sourcing request after any line has been converted");
      }
      const renewalIds = [...new Set(items.flatMap((item) => sourcingItemPredecessorIds(item)))];

      store.sourcingItems = store.sourcingItems.filter((i) => i.sourcingRequestId !== id);
      store.sourcingRequests = store.sourcingRequests.filter((r) => r.id !== id);

      for (const renewalLicenseId of renewalIds) {
        handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId: null });
      }
      return { data: null, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:59-145 merge_coterm_sourcing_items.
    method: "POST", pattern: /^\/api\/sourcing\/merge$/,
    handler: async ({ body }) => {
      const merged = mergeCotermSourcingItems(body?.sourcingItemIds ?? []);
      return { data: merged, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/sourcing\/(?<id>\d+)\/convert-freeware$/,
    handler: async ({ params }) => {
      const item = findSourcingItemOr404(Number(params.id));
      return { data: convertFreewareSourcingItems([item])[0], error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_conversion.py:79-136 convert_sourcing_item.
    method: "POST", pattern: /^\/api\/sourcing\/(?<id>\d+)\/convert$/,
    handler: async ({ params, body }) => {
      const item = findSourcingItemOr404(Number(params.id));
      const conversion = canonicalizeDemoReferenceFields(body);
      const order = convertSourcingItemToOrder(item, {
        pendingOrderId: conversion.pendingOrderId ?? null,
        poNumber: conversion.poNumber ?? null,
        supplier: conversion.supplier ?? null,
        notes: conversion.notes ?? null,
      });
      return { data: order, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:148-158 get_sourcing_item.
    method: "GET", pattern: /^\/api\/sourcing\/(?<id>\d+)$/,
    handler: async ({ params }) => ({ data: findSourcingItemOr404(Number(params.id)), error: null }),
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:188-229 update_sourcing_item
    // (exclude_unset semantics - only fields present on the body are applied).
    method: "PUT", pattern: /^\/api\/sourcing\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const item = findSourcingItemOr404(Number(params.id));
      assertSourcingItemEditable(item);
      const itemPayload = canonicalizeDemoReferenceFields(body);
      const allowed = [
        "publisherName", "softwareDescription", "licenseType", "quantity", "estimatedUnitPrice", "estimatedTotalPrice",
        "currency", "startDate", "endDate", "notes", "status",
      ];
      for (const field of allowed) {
        if (body && Object.prototype.hasOwnProperty.call(body, field)) {
          item[field] = itemPayload[field];
        }
      }
      const sourcingRequest = store.sourcingRequests.find(
        (candidate) => candidate.id === item.sourcingRequestId
      );
      if (sourcingRequest) {
        synchronizeOpenSourcingRequestIdentity(sourcingRequest, {
          ...(body && Object.prototype.hasOwnProperty.call(body, "supplier")
            ? { supplier: itemPayload.supplier }
            : {}),
          ...(body && Object.prototype.hasOwnProperty.call(body, "contactEmail")
            ? { contactEmail: body.contactEmail }
            : {}),
        });
      } else {
        if (body && Object.prototype.hasOwnProperty.call(body, "supplier")) {
          item.supplier = cleanProcurementIdentity(itemPayload.supplier);
        }
        if (body && Object.prototype.hasOwnProperty.call(body, "contactEmail")) {
          item.contactEmail = cleanProcurementIdentity(body.contactEmail);
        }
      }
      item.updatedAt = new Date().toISOString();
      return { data: item, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:232-268 delete_sourcing_item.
    method: "DELETE", pattern: /^\/api\/sourcing\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const id = Number(params.id);
      const item = findSourcingItemOr404(id);
      assertSourcingItemEditable(item);

      const renewalLicenseId = item.renewalForLicenseId;
      const renewalLicenseIds = sourcingItemPredecessorIds(item);
      const parentOrderId = item.pendingOrderId;
      store.sourcingItems = store.sourcingItems.filter((i) => i.id !== id);
      handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId, renewalLicenseIds });

      return { data: null, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:33-56 list_sourcing_items
    // (only "sourcing" status items whose parent request, if any, is also "sourcing").
    method: "GET", pattern: /^\/api\/sourcing$/,
    handler: async () => {
      const items = store.sourcingItems.filter((item) => {
        if (item.status !== "sourcing") return false;
        if (item.sourcingRequestId == null) return true;
        const request = store.sourcingRequests.find((r) => r.id === item.sourcingRequestId);
        return request ? request.status === "sourcing" : false;
      });
      return { data: items, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/sourcing_items.py:161-185 create_sourcing_item.
    method: "POST", pattern: /^\/api\/sourcing$/,
    handler: async ({ body }) => {
      const item = buildSourcingItem(canonicalizeDemoReferenceFields(body));
      store.sourcingItems.push(item);
      ensureSourcingRequestForItem(item);
      return { data: item, error: null };
    },
  },

  // Pending orders - specific routes registered before the generic /{id} routes.
  // Mirrors backend/app/routes/pending_order_core.py, pending_order_items.py,
  // pending_order_conversion.py (verified 2026-07-10). Document upload/download,
  // /export and /retry-evidence-transfer are intentionally left unregistered
  // (stub toast).

  {
    // THE golden-path finish line. Multipart on the wire: the router already
    // unwrapped the FormData "data" field into body. Response is
    // list[LicenseResponse] - new license(s) + renewed predecessor(s) - see
    // backend/app/routes/pending_order_conversion.py:28-58.
    method: "POST", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/convert$/,
    handler: async ({ params, body }) => {
      const order = findPendingOrderOr404(Number(params.id));
      return { data: convertPendingOrderToLicenses(order, canonicalizeDemoReferenceFields(body)), error: null };
    },
  },
  {
    // Mirrors backend/app/routes/pending_order_conversion.py:61-76 - the body is
    // a JSON ARRAY of BatchConvertItem; same list[LicenseResponse] response contract.
    method: "POST", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/convert-all$/,
    handler: async ({ params, body }) => {
      const order = findPendingOrderOr404(Number(params.id));
      const payload = (body ?? []).map(canonicalizeDemoReferenceFields);
      return { data: batchConvertPendingOrderToLicenses(order, payload), error: null };
    },
  },
  {
    // Mirrors backend/app/routes/pending_order_items.py:62-91 add_pending_order_items_bulk.
    method: "POST", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/items\/bulk$/,
    handler: async ({ params, body }) => {
      const order = findPendingOrderOr404(Number(params.id));
      const payload = (body ?? []).map(canonicalizeDemoReferenceFields);
      return { data: addPendingOrderItemsBulk(order, payload), error: null };
    },
  },
  {
    // Mirrors backend/app/routes/pending_order_items.py:94-119 update_pending_order_item
    // (exclude_unset semantics; the order row itself is untouched, so updatedAt stays).
    method: "PUT", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/items\/(?<itemId>\d+)$/,
    handler: async ({ params, body }) => {
      const order = findPendingOrderOr404(Number(params.id));
      ensurePendingOrderEditable(order, "update items on");
      const itemId = Number(params.itemId);
      const item = store.sourcingItems.find((i) => i.id === itemId && i.pendingOrderId === order.id);
      if (!item) throw new Error("Pending order item not found");
      const itemPayload = canonicalizeDemoReferenceFields(body);
      for (const field of PO_ITEM_UPDATE_FIELDS) {
        if (body && Object.prototype.hasOwnProperty.call(body, field)) {
          item[field] = itemPayload[field];
        }
      }
      if (item.licenseType === "freeware") {
        item.estimatedUnitPrice = null;
        item.estimatedTotalPrice = null;
      }
      item.updatedAt = new Date().toISOString();
      rebuildPendingOrderItems(order);
      return { data: order, error: null };
    },
  },
  {
    // Mirrors backend/app/routes/pending_order_items.py delete_pending_order_item.
    method: "DELETE", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/items\/(?<itemId>\d+)$/,
    handler: async ({ params }) => {
      const order = findPendingOrderOr404(Number(params.id));
      ensurePendingOrderEditable(order, "delete items from");
      const itemId = Number(params.itemId);
      const item = store.sourcingItems.find((i) => i.id === itemId && i.pendingOrderId === order.id);
      if (!item) throw new Error("Pending order item not found");
      const renewalLicenseId = item.renewalForLicenseId;
      const renewalLicenseIds = sourcingItemPredecessorIds(item);
      store.sourcingItems = store.sourcingItems.filter((i) => i.id !== itemId);
      handleSourcingItemDeleteSideEffects({ renewalLicenseId, parentOrderId: null, renewalLicenseIds });
      rebuildPendingOrderItems(order);
      if (order.items.length === 0) {
        order.status = "cancelled";
        order.updatedAt = new Date().toISOString();
      }
      return { data: order, error: null };
    },
  },
  {
    // Mirrors backend/app/services/pending_order_service.py:64-85 list_pending_order_records
    // (only active orders, newest first).
    method: "GET", pattern: /^\/api\/pending-orders$/,
    handler: async () => ({
      data: store.pendingOrders
        .filter((o) => o.status === "pending" || o.status === "invoice_received")
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(withPendingOrderLicenseRefs),
      error: null,
    }),
  },
  {
    method: "GET", pattern: /^\/api\/pending-orders\/history$/,
    handler: async () => ({
      data: store.pendingOrders
        .filter((o) => o.status === "converted" || o.status === "cancelled")
        .slice()
        .sort((a, b) => new Date(b.updatedAt ?? b.createdAt) - new Date(a.updatedAt ?? a.createdAt))
        .map(withPendingOrderLicenseRefs),
      error: null,
    }),
  },
  {
    // Mirrors backend/app/routes/pending_order_core.py:53-74 create_pending_order.
    method: "POST", pattern: /^\/api\/pending-orders$/,
    handler: async ({ body }) => {
      const orderPayload = canonicalizeDemoReferenceFields(body);
      return {
        data: createPendingOrderRecord({
          poNumber: orderPayload.poNumber,
          supplier: orderPayload.supplier ?? null,
          notes: orderPayload.notes ?? null,
        }),
        error: null,
      };
    },
  },
  {
    method: "GET", pattern: /^\/api\/pending-orders\/(?<id>\d+)$/,
    handler: async ({ params }) => ({ data: withPendingOrderLicenseRefs(findPendingOrderOr404(Number(params.id))), error: null }),
  },
  {
    // Mirrors backend/app/services/pending_order_service.py:100-114 apply_pending_order_update
    // (PendingOrderUpdate fields only - poNumber, supplier, notes, status; exclude_unset).
    method: "PUT", pattern: /^\/api\/pending-orders\/(?<id>\d+)$/,
    handler: async ({ params, body }) => {
      const order = findPendingOrderOr404(Number(params.id));
      ensurePendingOrderEditable(order, "update");
      const orderPayload = canonicalizeDemoReferenceFields(body);
      for (const field of ["poNumber", "supplier", "notes", "status"]) {
        if (body && Object.prototype.hasOwnProperty.call(body, field)) {
          order[field] = orderPayload[field];
        }
      }
      order.updatedAt = new Date().toISOString();
      return { data: order, error: null };
    },
  },
  {
    method: "POST", pattern: /^\/api\/pending-orders\/(?<id>\d+)\/cancel$/,
    handler: async ({ params }) => {
      const order = findPendingOrderOr404(Number(params.id));
      return { data: cancelPendingOrderRecord(order), error: null };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/pending-orders\/(?<id>\d+)$/,
    handler: async ({ params }) => {
      const order = findPendingOrderOr404(Number(params.id));
      deletePendingOrderRecord(order);
      return { data: null, error: null };
    },
  },
];

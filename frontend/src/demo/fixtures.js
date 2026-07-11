import { daysFromNow, datetimeDaysAgo, daysUntil } from "./time.js";
import { computeTotalPoValue } from "./store.js";

/**
 * Seed data for the demo mode in-memory store.
 *
 * All dates are computed relative to "now" via the time.js helpers so the
 * demo never goes stale. Money values are canonical decimal strings
 * ("1234.50", "250" — no thousands separators, no currency symbols).
 *
 * Field shapes mirror the backend's camelCase (to_camel alias) API responses:
 * LicenseResponse, SourcingItemResponse, SourcingItemSummary, PendingOrderResponse.
 */

const NOTIFICATION_DAYS = 30;

// Mirrors backend/app/services/license_service.py::compute_expiration_status
// (verified 2026-07-10, license_service.py:135-165). Priority order:
// retired > legacy > renewed > pending_renewal > perpetual > expired > expiring > active.
export function computeExpirationStatus({ isRetired, lifecycleStatus, endDate }) {
  if (isRetired) return "retired";
  if (lifecycleStatus === "legacy") return "legacy";
  if (lifecycleStatus === "renewed") return "renewed";
  if (lifecycleStatus === "pending_renewal") return "pending_renewal";
  if (endDate === null) return "perpetual";
  const days = daysUntil(endDate);
  if (days < 0) return "expired";
  if (days <= NOTIFICATION_DAYS) return "expiring";
  return "active";
}

function licenseRef(n) {
  return `LT-2026-${String(n).padStart(4, "0")}`;
}

/** Builds a full LicenseResponse-shaped object, filling in defaults for shared fields. */
export function buildLicense(overrides) {
  const isRetired = overrides.isRetired ?? false;
  const lifecycleStatus = overrides.lifecycleStatus ?? null;
  const endDate = overrides.endDate ?? null;

  const base = {
    // Core identification
    publisherName: "",
    softwareDescription: "",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "",
    skuCode: "",
    unitPrice: "",
    totalPoPrice: "",
    currency: "EUR",
    startDate: null,
    endDate: null,
    contractNumber: "",
    poNumber: "",
    invoiceNumber: "",
    pendingOrderId: null,
    contactEmail: "",
    supplier: "",
    costCentre: "",
    budgetOwnerEmail: "",
    portalUrl: null,
    notes: null,
    hasMaintenance: false,
    maintenanceCoverage: null,
    maintenanceStartDate: null,
    maintenanceEndDate: null,
    maintenanceCost: null,
    parentLicenseId: null,
    activeMaintenanceId: null,
    licenseRef: null,
    externalRef: null,
    lastSyncedAt: null,
    syncStatus: null,
    isRetired: false,
    isCompletenessExempt: false,
    lifecycleStatus: null,
    renewedFromId: null,
    renewedToId: null,
    cotermFromIds: null,
    createdAt: datetimeDaysAgo(365),
    updatedAt: datetimeDaysAgo(30),
    createdBy: 1,
    createdByName: "demo",
    createdByEmail: "demo@example.com",
    predecessorId: null,
    requestDate: null,
    purchaseDate: null,
    completenessPct: 80,
    documentCount: 0,
    customFields: [],
    conversionType: null,
  };

  const merged = { ...base, ...overrides, isRetired, lifecycleStatus, endDate };
  merged.daysUntilExpiry = daysUntil(merged.endDate);
  merged.expirationStatus = computeExpirationStatus({
    isRetired: merged.isRetired,
    lifecycleStatus: merged.lifecycleStatus,
    endDate: merged.endDate,
  });
  return merged;
}

export function buildSeedData() {
  const licenses = [];

  // 1. Centerpiece — drives the demo walkthrough: expiring in exactly 20 days.
  licenses.push(
    buildLicense({
      id: 1,
      publisherName: "Atlassian",
      softwareDescription: "Jira Software Data Center, 250 users",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "250",
      skuCode: "JIRA-DC-250",
      unitPrice: "42.50",
      totalPoPrice: "10625.00",
      currency: "EUR",
      startDate: daysFromNow(20 - 365),
      endDate: daysFromNow(20),
      contractNumber: "CTR-AT-2025-014",
      poNumber: "PO-2025-0871",
      invoiceNumber: "INV-AT-99231",
      contactEmail: "renewals@atlassian.com",
      supplier: "Northstar Procurement",
      costCentre: "Engineering",
      budgetOwnerEmail: "budget.owner@example.com",
      portalUrl: "https://my.atlassian.com",
      notes: "Data Center tier — renewal quote requested from Northstar Procurement.",
      hasMaintenance: false,
      licenseRef: licenseRef(1),
      createdAt: datetimeDaysAgo(365 - 20),
      updatedAt: datetimeDaysAgo(5),
      requestDate: datetimeDaysAgo(370),
      purchaseDate: datetimeDaysAgo(365),
      completenessPct: 95,
    })
  );

  // 2-9. Eight healthy active licenses (endDate 90-400 days out).
  const activeSpecs = [
    {
      publisherName: "JetBrains",
      softwareDescription: "All Products Pack, 40 seats",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "40",
      unitPrice: "279.00",
      totalPoPrice: "11160.00",
      supplier: "Direct Software Desk",
      costCentre: "Engineering",
      endOffset: 120,
    },
    {
      publisherName: "Microsoft",
      softwareDescription: "Microsoft 365 E3, 300 users",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "300",
      unitPrice: "32.10",
      totalPoPrice: "9630.00",
      supplier: "Bluepeak Resellers",
      costCentre: "IT-Operations",
      endOffset: 210,
    },
    {
      publisherName: "Adobe",
      softwareDescription: "Creative Cloud for Teams, 25 seats",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "25",
      unitPrice: "59.99",
      totalPoPrice: "1499.75",
      supplier: "Acme License Supply",
      costCentre: "Marketing",
      endOffset: 275,
    },
    {
      publisherName: "Veeam",
      softwareDescription: "Backup & Replication Enterprise Plus, 60 sockets",
      licenseType: "subscription",
      licenseMetric: "per_core",
      quantity: "60",
      unitPrice: "185.00",
      totalPoPrice: "11100.00",
      supplier: "Northstar Procurement",
      costCentre: "IT-Operations",
      endOffset: 340,
    },
    {
      publisherName: "Fortinet",
      softwareDescription: "FortiGate 200F UTM Bundle",
      licenseType: "subscription",
      licenseMetric: "enterprise",
      quantity: "1",
      unitPrice: "4200.00",
      totalPoPrice: "4200.00",
      supplier: "Bluepeak Resellers",
      costCentre: "IT-Operations",
      endOffset: 400,
      termDays: 1095, // 3-year UTM bundle — keeps startDate/createdAt in the past
    },
    {
      publisherName: "GitHub",
      softwareDescription: "GitHub Enterprise Cloud, 80 seats",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "80",
      unitPrice: "21.00",
      totalPoPrice: "1680.00",
      supplier: "Direct Software Desk",
      costCentre: "Engineering",
      endOffset: 150,
    },
    {
      publisherName: "Slack",
      softwareDescription: "Slack Business+, 200 users",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "200",
      unitPrice: "12.50",
      totalPoPrice: "2500.00",
      supplier: "Northstar Procurement",
      costCentre: "IT-Operations",
      endOffset: 95,
    },
    {
      publisherName: "Zoom",
      softwareDescription: "Zoom Workplace Business, 150 licenses",
      licenseType: "subscription",
      licenseMetric: "per_user",
      quantity: "150",
      unitPrice: "15.99",
      totalPoPrice: "2398.50",
      supplier: "Acme License Supply",
      costCentre: "IT-Operations",
      endOffset: 360, // < termDays so startDate/createdAt stay strictly in the past
    },
  ];

  activeSpecs.forEach((spec, idx) => {
    const id = idx + 2; // 2..9
    const termDays = spec.termDays ?? 365; // endOffset must stay below termDays
    const ageDays = termDays - spec.endOffset; // how long ago the term started
    const endDate = daysFromNow(spec.endOffset);
    const startDate = daysFromNow(-ageDays);
    licenses.push(
      buildLicense({
        id,
        publisherName: spec.publisherName,
        softwareDescription: spec.softwareDescription,
        licenseType: spec.licenseType,
        licenseMetric: spec.licenseMetric,
        quantity: spec.quantity,
        unitPrice: spec.unitPrice,
        totalPoPrice: spec.totalPoPrice,
        currency: "EUR",
        startDate,
        endDate,
        contractNumber: `CTR-${spec.publisherName.slice(0, 2).toUpperCase()}-2025-0${id}`,
        poNumber: `PO-2025-0${800 + id}`,
        supplier: spec.supplier,
        costCentre: spec.costCentre,
        budgetOwnerEmail: "budget.owner@example.com",
        contactEmail: `accounts@${spec.publisherName.toLowerCase().replace(/[^a-z]/g, "")}.com`,
        licenseRef: licenseRef(id),
        createdAt: datetimeDaysAgo(ageDays),
        updatedAt: datetimeDaysAgo(Math.min(60, ageDays)),
        completenessPct: 70 + ((id * 3) % 30),
      })
    );
  });

  // 10. Expired 15 days ago.
  licenses.push(
    buildLicense({
      id: 10,
      publisherName: "SolarWinds",
      softwareDescription: "Network Performance Monitor, 500 elements",
      licenseType: "subscription",
      licenseMetric: "enterprise",
      quantity: "500",
      unitPrice: "9.50",
      totalPoPrice: "4750.00",
      currency: "EUR",
      startDate: daysFromNow(-15 - 365),
      endDate: daysFromNow(-15),
      contractNumber: "CTR-SW-2024-007",
      poNumber: "PO-2024-1120",
      supplier: "Bluepeak Resellers",
      costCentre: "IT-Operations",
      contactEmail: "renewals@solarwinds.com",
      budgetOwnerEmail: "budget.owner@example.com",
      licenseRef: licenseRef(10),
      createdAt: datetimeDaysAgo(380),
      updatedAt: datetimeDaysAgo(15),
      notes: "Renewal quote overdue — follow up with Bluepeak Resellers.",
      completenessPct: 65,
    })
  );

  // 11. Perpetual (no end date) with separately tracked maintenance.
  const corelMaintenanceStart = daysFromNow(-135);
  const corelMaintenanceEnd = daysFromNow(230);
  const corelMaintenanceCost = "748.50";
  licenses.push(
    buildLicense({
      id: 11,
      publisherName: "Corel",
      softwareDescription: "CorelDRAW Graphics Suite, perpetual, 10 seats",
      licenseType: "perpetual",
      licenseMetric: "per_device",
      quantity: "10",
      unitPrice: "499.00",
      totalPoPrice: "4990.00",
      currency: "EUR",
      startDate: daysFromNow(-500),
      endDate: null,
      contractNumber: "CTR-COREL-2023-002",
      poNumber: "PO-2023-0455",
      supplier: "Acme License Supply",
      costCentre: "Marketing",
      contactEmail: "sales@corel.com",
      budgetOwnerEmail: "budget.owner@example.com",
      licenseRef: licenseRef(11),
      hasMaintenance: true,
      maintenanceCoverage: "separately_tracked",
      maintenanceStartDate: corelMaintenanceStart,
      maintenanceEndDate: corelMaintenanceEnd,
      maintenanceCost: corelMaintenanceCost,
      activeMaintenanceId: 15,
      createdAt: datetimeDaysAgo(500),
      updatedAt: datetimeDaysAgo(135),
      completenessPct: 90,
    })
  );

  licenses.push(
    buildLicense({
      id: 15,
      publisherName: "Corel",
      softwareDescription: "CorelDRAW Graphics Suite - Maintenance",
      licenseType: "maintenance",
      licenseMetric: "per_device",
      quantity: "10",
      unitPrice: "74.85",
      totalPoPrice: corelMaintenanceCost,
      currency: "EUR",
      startDate: corelMaintenanceStart,
      endDate: corelMaintenanceEnd,
      contractNumber: "CTR-COREL-MNT-2026-001",
      poNumber: "PO-2026-0315",
      supplier: "Acme License Supply",
      costCentre: "Marketing",
      contactEmail: "sales@corel.com",
      budgetOwnerEmail: "budget.owner@example.com",
      licenseRef: licenseRef(15),
      maintenanceCoverage: "not_applicable",
      parentLicenseId: 11,
      createdAt: datetimeDaysAgo(135),
      updatedAt: datetimeDaysAgo(20),
      completenessPct: 92,
    })
  );

  // 12. Retired.
  licenses.push(
    buildLicense({
      id: 12,
      publisherName: "Symantec",
      softwareDescription: "Endpoint Protection, 300 devices",
      licenseType: "subscription",
      licenseMetric: "per_device",
      quantity: "300",
      unitPrice: "18.00",
      totalPoPrice: "5400.00",
      currency: "EUR",
      startDate: daysFromNow(-800),
      endDate: daysFromNow(-440),
      contractNumber: "CTR-SYM-2023-011",
      poNumber: "PO-2023-0203",
      supplier: "Northstar Procurement",
      costCentre: "IT-Operations",
      contactEmail: "support@broadcom.com",
      budgetOwnerEmail: "budget.owner@example.com",
      licenseRef: licenseRef(12),
      isRetired: true,
      notes: "Replaced by Fortinet endpoint bundle; retained for audit trail.",
      createdAt: datetimeDaysAgo(800),
      updatedAt: datetimeDaysAgo(440),
      completenessPct: 100,
    })
  );

  // 13. SaaS with a portal URL.
  licenses.push(
    buildLicense({
      id: 13,
      publisherName: "HubSpot",
      softwareDescription: "Marketing Hub Professional, 5 seats",
      licenseType: "saas",
      licenseMetric: "per_user",
      quantity: "5",
      unitPrice: "890.00",
      totalPoPrice: "4450.00",
      currency: "EUR",
      startDate: daysFromNow(180 - 365),
      endDate: daysFromNow(180),
      contractNumber: "CTR-HS-2025-003",
      poNumber: "PO-2025-0640",
      supplier: "Direct Software Desk",
      costCentre: "Finance",
      contactEmail: "billing@hubspot.com",
      budgetOwnerEmail: "budget.owner@example.com",
      portalUrl: "https://app.hubspot.com",
      licenseRef: licenseRef(13),
      createdAt: datetimeDaysAgo(185),
      updatedAt: datetimeDaysAgo(20),
      completenessPct: 85,
    })
  );

  // 14. pending_renewal — linked FROM sourcing item 101 (see below).
  const pendingRenewalId = 14;
  licenses.push(
    buildLicense({
      id: pendingRenewalId,
      publisherName: "VMware",
      softwareDescription: "vSphere Enterprise Plus, 48 CPUs",
      licenseType: "subscription",
      licenseMetric: "per_cpu",
      quantity: "48",
      unitPrice: "310.00",
      totalPoPrice: "14880.00",
      currency: "EUR",
      startDate: daysFromNow(45 - 365),
      endDate: daysFromNow(45),
      contractNumber: "CTR-VMW-2025-009",
      poNumber: "PO-2025-0902",
      supplier: "Northstar Procurement",
      costCentre: "IT-Operations",
      contactEmail: "renewals@vmware.com",
      budgetOwnerEmail: "budget.owner@example.com",
      licenseRef: licenseRef(14),
      lifecycleStatus: "pending_renewal",
      notes: "Renewal in sourcing — see linked sourcing item.",
      createdAt: datetimeDaysAgo(320),
      updatedAt: datetimeDaysAgo(3),
      completenessPct: 88,
    })
  );

  // --- Sourcing items (2 standalone) ---
  const sourcingItems = [
    {
      id: 101,
      sourcingRequestId: null,
      publisherName: "VMware",
      softwareDescription: "vSphere Enterprise Plus, 48 CPUs — renewal",
      quantity: "48",
      estimatedUnitPrice: "325.00",
      estimatedTotalPrice: "15600.00",
      currency: "EUR",
      startDate: daysFromNow(46),
      endDate: daysFromNow(46 + 365),
      supplier: "Northstar Procurement",
      contactEmail: "renewals@vmware.com",
      notes: "Renewal quote received; pending budget sign-off.",
      status: "sourcing",
      pendingOrderId: null,
      renewalForLicenseId: pendingRenewalId,
      cotermPredecessorIds: null,
      isRenewal: true,
      createdAt: datetimeDaysAgo(10),
      updatedAt: datetimeDaysAgo(2),
      createdBy: 1,
    },
    {
      id: 102,
      sourcingRequestId: null,
      publisherName: "Datadog",
      softwareDescription: "Infrastructure Monitoring, 75 hosts",
      quantity: "75",
      estimatedUnitPrice: "23.00",
      estimatedTotalPrice: "1725.00",
      currency: "EUR",
      startDate: daysFromNow(60),
      endDate: daysFromNow(60 + 365),
      supplier: "Direct Software Desk",
      contactEmail: "sales@datadoghq.com",
      notes: "New observability tooling request from Engineering.",
      status: "sourcing",
      pendingOrderId: null,
      renewalForLicenseId: null,
      cotermPredecessorIds: null,
      isRenewal: false,
      createdAt: datetimeDaysAgo(6),
      updatedAt: datetimeDaysAgo(6),
      createdBy: 1,
    },
  ];

  // --- Pending order (1) with 2 line items ---
  const poId = 201;
  const poLineItemsRaw = [
    {
      id: 103,
      sourcingRequestId: null,
      publisherName: "Okta",
      softwareDescription: "Workforce Identity, 400 users",
      quantity: "400",
      estimatedUnitPrice: "18.00",
      estimatedTotalPrice: "7200.00",
      currency: "EUR",
      startDate: daysFromNow(30),
      endDate: daysFromNow(30 + 365),
      supplier: "Northstar Procurement",
      contactEmail: "sales@okta.com",
      notes: "SSO rollout — PO raised with Northstar Procurement.",
      status: "converted",
      renewalForLicenseId: null,
      cotermPredecessorIds: null,
    },
    {
      id: 104,
      sourcingRequestId: null,
      publisherName: "Okta",
      softwareDescription: "Advanced Server Access, 40 servers",
      quantity: "40",
      estimatedUnitPrice: "133.00",
      estimatedTotalPrice: "5320.00",
      currency: "EUR",
      startDate: daysFromNow(30),
      endDate: daysFromNow(30 + 365),
      supplier: "Northstar Procurement",
      contactEmail: "sales@okta.com",
      notes: "Bundled with the Workforce Identity order.",
      status: "converted",
      renewalForLicenseId: null,
      cotermPredecessorIds: null,
    },
  ];

  // These items also appear in sourcingItems (status: converted, pendingOrderId set)
  // so list pages that read from sourcingItems stay consistent with the PO detail view.
  for (const raw of poLineItemsRaw) {
    sourcingItems.push({
      ...raw,
      pendingOrderId: poId,
      isRenewal: raw.renewalForLicenseId !== null,
      createdAt: datetimeDaysAgo(12),
      updatedAt: datetimeDaysAgo(4),
      createdBy: 1,
    });
  }

  const poItems = poLineItemsRaw.map((raw) => ({
    ...raw,
    quoteDocuments: [],
    isRenewal: raw.renewalForLicenseId !== null,
  }));

  // totalPoValue mirrors backend _format_currency: symbol + thousands separators + 2dp
  // (see store.js::computeTotalPoValue, which mirrors PendingOrderResponse._compute_total_po_value).
  const totalPoValue = computeTotalPoValue(poItems);

  const pendingOrders = [
    {
      id: poId,
      poNumber: "PO-2026-0142",
      supplier: "Northstar Procurement",
      notes: "Okta SSO + server access bundle for the IT-Operations rollout.",
      status: "pending",
      createdAt: datetimeDaysAgo(12),
      updatedAt: datetimeDaysAgo(4),
      createdBy: 1,
      evidenceTransferStatus: null,
      evidenceTransferDetail: null,
      evidenceTransferFailedAt: null,
      items: poItems,
      documents: [],
      totalPoValue,
    },
  ];

  const contracts = [
    {
      id: 301,
      contractNumber: "CTR-AT-2025-014",
      publisherName: "Atlassian",
      notes: "Primary Jira Data Center agreement for the Engineering renewal flow.",
      createdAt: datetimeDaysAgo(350),
      createdBy: 1,
      folders: [
        { id: 401, name: "Signed agreement", createdAt: datetimeDaysAgo(350), documentCount: 0 },
        { id: 402, name: "Renewal quotes", createdAt: datetimeDaysAgo(25), documentCount: 0 },
      ],
    },
    {
      id: 302,
      contractNumber: "CTR-VMW-2025-009",
      publisherName: "VMware",
      notes: "Renewal currently represented in sourcing; useful for testing linked-license navigation.",
      createdAt: datetimeDaysAgo(320),
      createdBy: 1,
      folders: [
        { id: 403, name: "Commercials", createdAt: datetimeDaysAgo(320), documentCount: 0 },
      ],
    },
    {
      id: 303,
      contractNumber: "CTR-COREL-2023-002",
      publisherName: "Corel",
      notes: "Perpetual entitlement with separately tracked maintenance.",
      createdAt: datetimeDaysAgo(500),
      createdBy: 1,
      folders: [
        { id: 404, name: "Entitlement", createdAt: datetimeDaysAgo(500), documentCount: 0 },
        { id: 405, name: "Maintenance", createdAt: datetimeDaysAgo(135), documentCount: 0 },
      ],
    },
    {
      id: 304,
      contractNumber: "CTR-OKTA-2026-0142",
      publisherName: "Okta",
      notes: "Draft contract record for the pending PO bundle.",
      createdAt: datetimeDaysAgo(12),
      createdBy: 1,
      folders: [],
    },
  ];

  const contractDocuments = [
    {
      id: 501,
      contractId: 301,
      folderId: 401,
      filename: "contracts/301/atlassian_signed_agreement.pdf",
      originalFilename: "Atlassian signed agreement.pdf",
      fileSize: 184320,
      createdAt: datetimeDaysAgo(349),
    },
    {
      id: 502,
      contractId: 301,
      folderId: 402,
      filename: "contracts/301/atlassian_renewal_quote.pdf",
      originalFilename: "Atlassian renewal quote.pdf",
      fileSize: 96256,
      createdAt: datetimeDaysAgo(18),
    },
    {
      id: 503,
      contractId: 302,
      folderId: 403,
      filename: "contracts/302/vmware_budget_quote.pdf",
      originalFilename: "VMware budget quote.pdf",
      fileSize: 128512,
      createdAt: datetimeDaysAgo(8),
    },
    {
      id: 504,
      contractId: 303,
      folderId: 404,
      filename: "contracts/303/corel_entitlement.pdf",
      originalFilename: "Corel entitlement certificate.pdf",
      fileSize: 74240,
      createdAt: datetimeDaysAgo(498),
    },
    {
      id: 505,
      contractId: 303,
      folderId: 405,
      filename: "contracts/303/corel_maintenance.pdf",
      originalFilename: "Corel maintenance confirmation.pdf",
      fileSize: 65536,
      createdAt: datetimeDaysAgo(132),
    },
  ];

  return {
    licenses,
    contracts,
    contractDocuments,
    sourcingItems,
    sourcingRequests: [],
    pendingOrders,
  };
}

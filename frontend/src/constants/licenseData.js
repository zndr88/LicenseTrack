export const LICENSE_TYPES = [
  { value: "freeware", label: "Freeware / Open Source" },
  { value: "maintenance", label: "Maintenance" },
  { value: "oem", label: "OEM" },
  { value: "other", label: "Other" },
  { value: "perpetual", label: "Perpetual" },
  { value: "saas", label: "SaaS" },
  { value: "service", label: "Service" },
  { value: "subscription", label: "Subscription" },
];

export const NON_EXPIRING_LICENSE_TYPES = ["perpetual", "oem", "freeware", "service", "other"];
export const NON_ENTITLEMENT_LICENSE_TYPES = ["freeware", "service", "other"];
export const NON_RENEWABLE_LICENSE_TYPES = ["service", "other"];

export const MAINTENANCE_COVERAGE_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "not_applicable", label: "Not applicable" },
  { value: "included", label: "Included" },
  { value: "separately_tracked", label: "Separately tracked" },
];

export const LICENSE_METRICS = [
  { value: "per_user", label: "Per User" },
  { value: "per_device", label: "Per Device" },
  { value: "per_cpu", label: "Per CPU" },
  { value: "per_core", label: "Per Core" },
  { value: "site", label: "Site License" },
  { value: "concurrent", label: "Concurrent Users" },
  { value: "enterprise", label: "Enterprise-wide" },
];

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK"];

export const DEFAULT_STATUS_FILTERS = ["active", "expiring", "expired"];

// Blank form used when adding a license manually (no invoice upload).
export const createManualEntryData = () => ({
  publisherName: "", softwareDescription: "", startDate: "", endDate: "", noticeDate: "",
  contractNumber: "", poNumber: "", invoiceNumber: "", contactEmail: "",
  supplier: "", costCentre: "", licenseType: "", licenseMetric: "",
  portalUrl: "", quantity: "", skuCode: "", unitPrice: "", totalPoPrice: "", currency: "EUR", notes: "", budgetOwnerEmail: "", fileName: "manual-entry",
  strategyUsed: "manual", attemptedStrategies: [], fallbackUsed: false, engineDetails: [],
});

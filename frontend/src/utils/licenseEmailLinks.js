import { isNonExpiringLicenseType } from "./licenseTypeRules.js";

const hasText = (value) => String(value ?? "").trim() !== "";

function formatPeriod(license) {
  const endLabel = hasText(license.endDate)
    ? license.endDate
    : (isNonExpiringLicenseType(license.licenseType) ? "Perpetual" : "");
  if (hasText(license.startDate) && endLabel) return `${license.startDate} -> ${endLabel}`;
  if (hasText(license.startDate)) return `from ${license.startDate}`;
  return endLabel ? `until ${endLabel}` : "";
}

/** Render "Label: value" lines, skipping blank values so emails never show empty or null fields. */
function labelledLines(entries, indent = "") {
  return entries
    .filter(([, value]) => hasText(value))
    .map(([label, value]) => `${indent}${label}: ${value}`);
}

function mailtoHref(address, subject, body) {
  return `mailto:${address || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function singleLicenseSubject(license) {
  const description = license.softwareDescription || "License";
  if (hasText(license.contractNumber)) return `Re: Contract ${license.contractNumber} - ${description}`;
  if (hasText(license.poNumber)) return `Re: PO ${license.poNumber} - ${description}`;
  return `Re: ${description}`;
}

export function buildSingleLicenseEmailHref(license) {
  const details = labelledLines([
    ["Contract", license.contractNumber],
    ["PO", license.poNumber],
    ["Invoice", license.invoiceNumber],
    ["Software", license.softwareDescription],
    ["Period", formatPeriod(license)],
  ]).join("\n");
  const body = `Dear ${license.publisherName} team,\n\nI am writing regarding:\n\n${details}\n\nBest regards`;
  return mailtoHref(license.contactEmail, singleLicenseSubject(license), body);
}

export function buildMultiLicenseEmailHref(license, licenses) {
  const subject = `Re: PO ${license.poNumber} - ${license.publisherName} licenses`;
  const lines = licenses.map((item, idx) => [
    `${idx + 1}. ${item.softwareDescription || "Untitled license"}`,
    ...labelledLines([
      ["Contract", item.contractNumber],
      ["PO", item.poNumber],
      ["Invoice", item.invoiceNumber],
      ["Period", formatPeriod(item)],
      ["Quantity", item.quantity],
      ["SKU", item.skuCode],
    ], "   "),
  ].join("\n")).join("\n\n");
  const body = `Dear ${license.publisherName} team,\n\nI am writing regarding purchase order ${license.poNumber} and the following license lines:\n\n${lines}\n\nBest regards`;
  return mailtoHref(license.contactEmail, subject, body);
}

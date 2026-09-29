// The one place that decides how maintenance records and their parent
// licenses appear and are searched in linking dialogs.

const lower = (parts) => parts.filter((part) => part !== undefined && part !== null && part !== "").join(" ").toLowerCase();

function refOf(license) {
  return license.licenseRef || `#${license.id}`;
}

function nameOf(license) {
  return `${license.publisherName || ""} / ${license.softwareDescription || ""}`;
}

export function isLinkedToParent(license, parentId) {
  // parentLicenseId is kept on detached records as history; only the
  // association list is an active link.
  return (license.maintenanceParentIds || []).some((id) => Number(id) === Number(parentId));
}

export function isHiddenFromLinking(license) {
  return Boolean(license.isRetired || license.retired || license.retirementScheduled);
}

function commonSearchParts(license) {
  return [license.id, license.licenseRef, license.publisherName, license.softwareDescription,
    license.poNumber, license.contractNumber, license.startDate, license.endDate];
}

export function parentCandidate(license) {
  return {
    id: license.id,
    title: `${refOf(license)} — ${nameOf(license)}`,
    meta: [license.poNumber, license.contractNumber].filter(Boolean).join(" · ") || undefined,
    searchText: lower(commonSearchParts(license)),
  };
}

export function maintenanceCandidate(license, allLicenses) {
  const covered = (license.maintenanceParentIds || [])
    .map((id) => allLicenses.find((candidate) => Number(candidate.id) === Number(id)))
    .filter(Boolean);
  const coveredLabel = covered.map((parent) => `${refOf(parent)} ${nameOf(parent)}`).join("; ");
  const coversText = covered.length ? `Currently covers: ${coveredLabel}` : "";
  const subtitle = [license.isLegacyUnlinkedMaintenance ? "Legacy unlinked" : "", coversText]
    .filter(Boolean).join(" · ");
  return {
    id: license.id,
    title: `${refOf(license)} — ${nameOf(license)}`,
    subtitle: subtitle || undefined,
    meta: [license.poNumber || "No PO", license.contractNumber || "No contract",
      `${license.startDate || "-"} -> ${license.endDate || "-"}`].join(" · "),
    coversText,
    coveredLabel,
    searchText: lower([...commonSearchParts(license), ...covered.flatMap((parent) => [parent.licenseRef, parent.publisherName, parent.softwareDescription])]),
  };
}

// Asked before a maintenance record that already covers another license is
// linked to one more. Returns null when the record covers nothing yet.
export function coversConfirmMessage(candidate) {
  if (!candidate?.coveredLabel) return null;
  return `This maintenance record already covers ${candidate.coveredLabel}. Also cover this license?`;
}

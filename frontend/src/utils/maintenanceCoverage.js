import { MAINTENANCE_COVERAGE_OPTIONS } from "../constants/licenseData.js";

const INCLUDED_SUPPORT_LICENSE_TYPES = new Set(["freeware", "perpetual", "oem", "subscription", "saas"]);
const SEPARATE_MAINTENANCE_PARENT_TYPES = new Set(["freeware", "perpetual", "oem"]);

export function supportsMaintenanceCoverage(licenseType) {
  return INCLUDED_SUPPORT_LICENSE_TYPES.has(licenseType);
}

export function supportsSeparateMaintenanceLine(licenseType) {
  return SEPARATE_MAINTENANCE_PARENT_TYPES.has(licenseType);
}

export function isBundledIncludedSupport(licenseType, coverage) {
  return (licenseType === "subscription" || licenseType === "saas") && coverage === "included";
}

export function defaultMaintenanceCoverageForLicenseType(licenseType) {
  if (licenseType === "subscription" || licenseType === "saas") return "included";
  if (supportsSeparateMaintenanceLine(licenseType)) return "unknown";
  return "not_applicable";
}

export function maintenanceCoverageOptionsForLicenseType(licenseType) {
  if (!supportsSeparateMaintenanceLine(licenseType)) {
    return MAINTENANCE_COVERAGE_OPTIONS.filter((option) => option.value !== "separately_tracked");
  }
  return MAINTENANCE_COVERAGE_OPTIONS;
}

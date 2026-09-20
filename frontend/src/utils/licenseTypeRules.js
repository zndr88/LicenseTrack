import { NON_EXPIRING_LICENSE_TYPES } from "../constants/licenseData.js";

/**
 * A license type that never carries a fixed end date (perpetual/oem/freeware/
 * service/other). The backend enforces `end_date IS NULL` for these, so the UI
 * suppresses the end-date input rather than offering a separate toggle.
 */
export function isNonExpiringLicenseType(licenseType) {
  return NON_EXPIRING_LICENSE_TYPES.includes(licenseType);
}

/** Clear the end date when the license type is non-expiring; otherwise return as-is. */
export function suppressEndDateForType(data) {
  if (!isNonExpiringLicenseType(data.licenseType)) return data;
  return { ...data, endDate: "" };
}

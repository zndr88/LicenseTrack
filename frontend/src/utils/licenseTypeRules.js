import { NON_EXPIRING_LICENSE_TYPES, RENEWAL_OPT_IN_LICENSE_TYPES } from "../constants/licenseData.js";

/**
 * A license type that never carries a fixed end date (perpetual/oem/freeware).
 * The backend enforces `end_date IS NULL` for these, so the UI suppresses the
 * end-date input rather than offering a separate toggle. Service and Other may
 * carry an end date.
 */
export function isNonExpiringLicenseType(licenseType) {
  return NON_EXPIRING_LICENSE_TYPES.includes(licenseType);
}

/** Clear the end date when the license type is non-expiring; otherwise return as-is. */
export function suppressEndDateForType(data) {
  if (!isNonExpiringLicenseType(data.licenseType)) return data;
  return { ...data, endDate: "" };
}

/** Service/Other offer a "Renewable?" opt-in; every other type renews by type. */
export function isRenewalOptInLicenseType(licenseType) {
  return RENEWAL_OPT_IN_LICENSE_TYPES.includes(licenseType);
}

/** Mirrors backend is_renewable_license: Service/Other renew only when marked renewable. */
export function isRenewableLicense(license) {
  if (isRenewalOptInLicenseType(license?.licenseType)) return license?.isRenewable === true;
  return true;
}

/** Mirrors backend type_description_missing: an Other purchase needs a short description. */
export function typeDescriptionMissing(licenseType, typeDescription) {
  return licenseType === "other" && String(typeDescription ?? "").trim() === "";
}

export const TYPE_DESCRIPTION_REQUIRED_MESSAGE = "Describe what this Other purchase is.";

/** "Yes"/"No" for Service/Other, "" for types where renewability is fixed by type. */
export function renewableLabel(license) {
  if (!isRenewalOptInLicenseType(license?.licenseType)) return "";
  return license?.isRenewable === true ? "Yes" : "No";
}

/** Payload values for the Service/Other opt-in fields, cleared for types that do not use them. */
export function typeOptInPayload(data) {
  const description = String(data?.typeDescription ?? "").trim();
  return {
    isRenewable: isRenewalOptInLicenseType(data?.licenseType) ? Boolean(data?.isRenewable) : null,
    typeDescription: data?.licenseType === "other" && description ? description : null,
  };
}

/** Registry/detail badge for included support on perpetual/OEM/freeware records. */
export function supportStatusBadge(license) {
  const days = license?.supportDaysRemaining;
  if (license?.supportStatus === "expired") {
    return { type: "red", label: "Support expired" };
  }
  if (license?.supportStatus === "expiring") {
    return { type: "orange", label: days === 0 ? "Support ends today" : `Support ends in ${days}d` };
  }
  return null;
}

/** True when included support needs attention (expiring or expired). */
export function isSupportDue(license) {
  return ["expiring", "expired"].includes(license?.supportStatus);
}

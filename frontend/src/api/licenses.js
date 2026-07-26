/**
 * License API - CRUD, stats, and CSV export.
 *
 * Endpoints:
 *   GET    /api/licenses - list licenses (active by default)
 *   GET    /api/licenses/stats - dashboard statistics
 *   GET    /api/licenses/export - download CSV
 *   GET    /api/licenses/{id} - single license
 *   POST   /api/licenses - create license
 *   PUT    /api/licenses/{id} - update license
 *   DELETE /api/licenses/{id} - delete license (+ its documents)
 */

import { del, get, post, put, request } from "./client.js";

/**
 * Fetch all licenses.
 *
 * @param {{ includeRetired?: boolean }} [options]
 * @returns {Promise<{ data: object[] | null, error: string | null }>}
 */
export async function getLicenses({ includeRetired = false } = {}) {
  const query = includeRetired ? "?include_retired=true" : "";
  return get(`/api/licenses${query}`);
}

/**
 * Fetch all maintenance Licenses for a given parent, including retired ones.
 * Used for history display in the parent's DetailPanel Maintenance section.
 */
export async function getMaintenanceForParent(parentId) {
  return get(`/api/licenses?parent_license_id=${parentId}&include_retired=true`);
}

/**
 * Fetch a single license by ID.
 *
 * @param {number} id
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getLicense(id) {
  return get(`/api/licenses/${id}`);
}

/**
 * Fetch the procurement trail for a license.
 *
 * @param {number} id
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getLicenseProcurementTrail(id) {
  return get(`/api/licenses/${id}/procurement-trail`);
}

/**
 * Create a new license.
 *
 * @param {object} licenseData - matches LicenseCreate schema
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function createLicense(licenseData) {
  return post("/api/licenses", licenseData);
}

/**
 * Update an existing license (partial updates supported).
 *
 * @param {number} id
 * @param {object} licenseData - matches LicenseUpdate schema
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateLicense(id, licenseData) {
  return put(`/api/licenses/${id}`, licenseData);
}

/**
 * Delete a license and all its associated documents.
 *
 * @param {number} id
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function deleteLicense(id) {
  return del(`/api/licenses/${id}`);
}

/**
 * Delete multiple licenses by ID in a single transaction.
 * Missing IDs are silently skipped.
 *
 * @param {number[]} ids
 * @returns {Promise<{ data: { deleted: number } | null, error: string | null }>}
 */
export async function bulkDeleteLicenses(ids) {
  return request("/api/licenses/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

/**
 * Cancel a pending renewal for a license.
 *
 * Clears lifecycle_status back to active and cancels the sourcing request if it
 * has not yet been promoted to a PO. Returns { license, poWarning }.
 *
 * @param {number} licenseId
 * @returns {Promise<{ data: { license: object, poWarning: boolean } | null, error: string | null }>}
 */
export async function cancelRenewal(licenseId) {
  return post(`/api/licenses/${licenseId}/cancel-renewal`, {});
}

/**
 * Disable linked maintenance/support tracking on a perpetual/OEM/freeware License.
 * The currently active maintenance License is retired and the parent's mirror
 * fields are cleared.
 */
export async function disableMaintenance(licenseId) {
  return post(`/api/licenses/${licenseId}/disable-maintenance`, {});
}

/**
 * Initiate the renewal pipeline for an existing license.
 *
 * Sets lifecycle_status to "pending_renewal" and creates a SourcingItem pre-filled
 * with the license's data. Returns { license, sourcingItem }.
 *
 * @param {number} id
 * @returns {Promise<{ data: { license: object, sourcingItem: object } | null, error: string | null }>}
 */
export async function initiateRenewal(id) {
  return post(`/api/licenses/${id}/initiate-renewal`, {});
}

/**
 * Initiate one renewal sourcing request containing multiple license lines.
 *
 * @param {number[]} licenseIds
 * @returns {Promise<{ data: { licenses: object[], sourcingRequest: object } | null, error: string | null }>}
 */
export async function initiateRenewalBundle(licenseIds) {
  return post("/api/licenses/renewal-bundle/initiate", { licenseIds });
}

/**
 * PATCH a single named field on a license.
 *
 * @param {number} id
 * @param {string} field - camelCase field name, e.g. "publisherName"
 * @param {string} value - new value (always sent as string; backend coerces dates)
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function patchLicenseField(id, field, value) {
  return request(`/api/licenses/${id}/field`, {
    method: "PATCH",
    body: JSON.stringify({ field, value }),
  });
}

/**
 * Mark the current notice deadline as handled for reminder suppression.
 *
 * @param {number} id
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function markLicenseNoticeHandled(id) {
  return post(`/api/licenses/${id}/notice/handled`, {});
}


/**
 * Fetch dashboard statistics (counts, expiration breakdown, etc.).
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getStats() {
  return get("/api/licenses/stats");
}

/**
 * GET /api/licenses/{id}/custom-fields
 * Returns { values: [...] } with definitions inline.
 *
 * @param {number} licenseId
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getCustomFieldValues(licenseId) {
  return get(`/api/licenses/${licenseId}/custom-fields/`);
}

/**
 * GET /api/custom-fields/values
 * Returns all custom field values across all licenses in a single request.
 * Returns { values: CustomFieldValueResponse[] }.
 */
export async function getAllCustomFieldValues() {
  return get("/api/custom-fields/values");
}

/**
 * PUT /api/licenses/{id}/custom-fields
 * Partial upsert - only fields in the payload are updated.
 * payload: { values: [{ customFieldDefId, valueText?, valueCurrency? }] }
 *
 * @param {number} licenseId
 * @param {object} payload
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function upsertCustomFieldValues(licenseId, payload) {
  return put(`/api/licenses/${licenseId}/custom-fields/`, payload);
}

/**
 * Trigger a CSV export and initiate a browser file download.
 * Returns { data: null, error } - the download is handled as a side-effect.
 *
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function exportCsv() {
  const { data: response, error } = await get("/api/licenses/export");
  if (error || !response) {
    return { data: null, error: error ?? "Export failed" };
  }

  // Trigger browser download from the streamed response
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "licenses_export.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

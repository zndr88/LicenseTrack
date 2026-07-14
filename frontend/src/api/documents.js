/**
 * Document API - upload, list, download, and delete license documents.
 *
 * Endpoints:
 *   POST   /api/licenses/{licenseId}/documents - upload a file
 *   GET    /api/licenses/{licenseId}/documents - list documents for a license
 *   GET    /api/documents/{documentId}/download - stream / download a file
 *   DELETE /api/documents/{documentId} - delete record + file from disk
 */

import { del, get, post } from "./client.js";

/**
 * Upload a file and attach it to a license.
 *
 * @param {number} licenseId
 * @param {File} file - the File object from an <input type="file">
 * @param {string} category - DocumentCategory value, e.g. "invoice" | "contract" | "other"
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function uploadDocument(licenseId, file, category) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  // Pass FormData directly - client.js omits Content-Type so the browser sets
  // the correct multipart boundary automatically.
  return post(`/api/licenses/${licenseId}/documents`, formData);
}

/**
 * List all documents attached to a license.
 *
 * @param {number} licenseId
 * @returns {Promise<{ data: object[] | null, error: string | null }>}
 */
export async function getDocuments(licenseId) {
  return get(`/api/licenses/${licenseId}/documents`);
}

/**
 * Download a document and trigger a browser file-save dialog.
 * Returns { data: null, error } - the download is handled as a side-effect.
 *
 * @param {number} documentId
 * @param {string} [filename] - suggested filename for the download dialog
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function downloadDocument(documentId, filename) {
  const { data: response, error } = await get(
    `/api/documents/${documentId}/download`
  );
  if (error || !response) {
    return { data: null, error: error ?? "Download failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

export async function downloadProcurementDocument(documentId, filename) {
  const { data: response, error } = await get(
    `/api/procurement-documents/${documentId}/download`
  );
  if (error || !response) {
    return { data: null, error: error ?? "Download failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

/**
 * Delete a document (database record + file on disk).
 *
 * @param {number} documentId
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function deleteDocument(documentId) {
  return del(`/api/documents/${documentId}`);
}

export async function deleteProcurementDocument(documentId) {
  return del(`/api/procurement-documents/${documentId}`);
}

export async function listDocumentActions() {
  return get("/api/document-actions");
}

export async function invokeDocumentAction(actionKey, payload) {
  return post(`/api/document-actions/${actionKey}/invoke`, payload);
}

export async function listDocumentProcessingResults(params = {}) {
  const query = new URLSearchParams();
  if (params.licenseId) query.set("license_id", params.licenseId);
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return get(`/api/document-processing-results${suffix}`);
}

export async function acceptDocumentProcessingResult(resultId, suggestedFieldIndexes = null) {
  const path = `/api/document-processing-results/${resultId}/accept`;
  if (Array.isArray(suggestedFieldIndexes)) {
    return post(path, { suggestedFieldIndexes });
  }
  return post(path);
}

export async function rejectDocumentProcessingResult(resultId) {
  return post(`/api/document-processing-results/${resultId}/reject`);
}

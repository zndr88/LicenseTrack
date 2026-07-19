/**
 * CSV import API - preview, confirm, and template download.
 *
 * Endpoints:
 *   POST /api/import/preview - parse & classify a CSV file (no DB write)
 *   POST /api/import/confirm - re-parse and persist valid rows
 *   GET  /api/import/template - download the blank CSV template
 */

import { get, post, put, del } from "./client.js";

/**
 * Upload a CSV file for preview.  Returns per-row classification and
 * summary counts without writing anything to the database.
 *
 * @param {File} file
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
function appendImportFormats(formData, formats = {}) {
  if (formats.numberFormatLocale) formData.append("number_format_locale", formats.numberFormatLocale);
  if (formats.dateFormat) formData.append("date_format", formats.dateFormat);
}

export async function previewCsvImport(file, formats, updateExisting = false) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("update_existing", String(updateExisting));
  appendImportFormats(formData, formats);
  return post("/api/import/preview", formData);
}

/**
 * Upload the same CSV file to confirm import.  Re-parses server-side
 * and persists all importable rows.
 *
 * @param {File} file
 * @param {number[]} skippedRows
 * @param {boolean} acknowledgeWarnings - must be true when preview showed hasWarnings
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function confirmCsvImport(
  file,
  skippedRows = [],
  acknowledgeWarnings = false,
  formats,
  updateExisting = false,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("skipped_rows_json", JSON.stringify(skippedRows));
  formData.append("acknowledge_warnings", String(acknowledgeWarnings));
  formData.append("update_existing", String(updateExisting));
  appendImportFormats(formData, formats);
  return post("/api/import/confirm", formData);
}

/**
 * POST /api/import/analyze - send a CSV file for column analysis.
 * Returns matched columns, unrecognized columns, and missing required columns.
 *
 * @param {File} file
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function analyzeImport(file) {
  const form = new FormData();
  form.append("file", file);
  return post("/api/import/analyze", form);
}

/**
 * POST /api/import/execute - send a CSV file with a resolved column mapping.
 * Persists all importable rows.
 *
 * @param {File} file
 * @param {string} mappingJson - JSON-serialised mapping array + optional preset name
 * @param {number[]} skippedRows
 * @param {boolean} acknowledgeWarnings - must be true when preview showed hasWarnings
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function executeImport(file, mappingJson, skippedRows = [], acknowledgeWarnings = false, formats, updateExisting = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping_json", mappingJson);
  form.append("skipped_rows_json", JSON.stringify(skippedRows));
  form.append("acknowledge_warnings", String(acknowledgeWarnings));
  form.append("update_existing", String(updateExisting));
  appendImportFormats(form, formats);
  return post("/api/import/execute", form);
}

/**
 * POST /api/import/preview-mapped - preview rows using a resolved column mapping.
 *
 * @param {File} file
 * @param {string} mappingJson - JSON-serialised mapping array + optional preset name
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function previewMappedImport(file, mappingJson, formats, updateExisting = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping_json", mappingJson);
  form.append("update_existing", String(updateExisting));
  appendImportFormats(form, formats);
  return post("/api/import/preview-mapped", form);
}

/**
 * GET /api/import/mappings - list saved mapping presets.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function listImportMappings() {
  return get("/api/import/mappings");
}

/**
 * DELETE /api/import/mappings/{id} - delete a saved mapping preset.
 *
 * @param {number} id
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function deleteImportMapping(id) {
  return del(`/api/import/mappings/${id}`);
}

export async function putImportMapping(id, name, mapping) {
  return put(`/api/import/mappings/${id}`, { name, mapping });
}

/**
 * Download the CSV import template and trigger a browser file-save dialog.
 *
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function downloadCsvTemplate() {
  const { data: response, error } = await get("/api/import/template");
  if (error || !response) {
    return { data: null, error: error ?? "Template download failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "license_lifecycle_template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

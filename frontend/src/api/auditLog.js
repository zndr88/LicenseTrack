import { get } from "./client.js";

/**
 * Fetch a paginated audit log.
 *
 * @param {Object} params - Query parameters:
 *   page, pageSize, actorEmail, action, dateFrom, dateTo, search
 */
export async function getAuditLog(params = {}) {
  const entries = Object.entries({
    page: params.page,
    page_size: params.pageSize,
    actor_email: params.actorEmail,
    action: params.action,
    date_from: params.dateFrom,
    date_to: params.dateTo,
    search: params.search,
  }).filter(([, v]) => v !== null && v !== undefined && v !== "");

  const qs = new URLSearchParams(entries);
  return get(`/api/audit-log?${qs}`);
}

/**
 * Download all matching audit log rows as a CSV file.
 * Triggers a browser file download.
 */
export async function exportAuditLog(params = {}) {
  const entries = Object.entries({
    actor_email: params.actorEmail,
    action: params.action,
    date_from: params.dateFrom,
    date_to: params.dateTo,
    search: params.search,
  }).filter(([, v]) => v !== null && v !== undefined && v !== "");

  const qs = new URLSearchParams(entries);
  const { data: response, error } = await get(`/api/audit-log/export?${qs}`);
  if (error || !response) {
    return { data: null, error: error ?? "Export failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "audit_log.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

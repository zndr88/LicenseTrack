import { get } from "./client.js";
import { downloadApiFile } from "./download.js";

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
  return downloadApiFile(`/api/audit-log/export?${qs}`, {
    filename: "audit_log.csv",
    fallbackError: "Export failed",
  });
}

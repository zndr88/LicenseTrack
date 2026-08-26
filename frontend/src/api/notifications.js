/**
 * Notifications API - aggregated license alerts.
 *
 * Endpoint:
 *   GET /api/notifications - returns expiring, expired, notice deadline,
 *                            and incomplete alerts
 *                            sorted by severity (critical -> warning -> info)
 *                            then by relevant date ascending
 */

import { get } from "./client.js";

/**
 * Fetch all license notifications for the current user.
 *
 * Each item has the shape:
 *   {
 *     license_id:    number,
 *     software_name: string,
 *     publisher:     string,
 *     budget_owner_email: string,
 *     type:          "expired" | "expiring" | "notice_due" | "incomplete",
 *     detail:        string,
 *     severity:      "critical" | "warning" | "info",
 *     relevant_date: string | null,   // ISO date string
 *   }
 *
 * @returns {Promise<{ data: object[] | null, error: string | null }>}
 */
export async function getNotifications() {
  return get("/api/notifications");
}

import { get } from "./client.js";

/**
 * Fetch server-side portfolio summary statistics.
 *
 * Returns total_active, total_expiring, total_expired, total_incomplete,
 * annual_cost_by_currency, excluded_from_totals, and by_license_type breakdown.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getPortfolioStats() {
  const { data, error } = await get("/api/reports/portfolio-stats");
  if (error) throw new Error(error);
  return data;
}

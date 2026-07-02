import { get } from "./client.js";

export async function getRenewalWorkbench(params = {}) {
  const query = new URLSearchParams();
  if (params.window_days !== undefined) query.set("window_days", params.window_days);
  if (params.windowDays !== undefined) query.set("window_days", params.windowDays);
  if (params.view) query.set("view", params.view);

  const qs = query.toString();
  return get(`/api/renewals/workbench${qs ? `?${qs}` : ""}`);
}

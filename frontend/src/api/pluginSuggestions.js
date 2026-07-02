import { get, post } from "./client.js";

export async function listPluginSuggestions(params = {}) {
  const query = new URLSearchParams();
  if (params.licenseId) query.set("licenseId", params.licenseId);
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return get(`/api/plugin-suggestions${suffix}`);
}

export async function acceptPluginSuggestion(suggestionId, suggestedFieldIndexes = null) {
  const path = `/api/plugin-suggestions/${suggestionId}/accept`;
  if (Array.isArray(suggestedFieldIndexes)) {
    return post(path, { suggestedFieldIndexes });
  }
  return post(path);
}

export async function rejectPluginSuggestion(suggestionId) {
  return post(`/api/plugin-suggestions/${suggestionId}/reject`);
}

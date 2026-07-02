import { get, post } from "./client.js";

export async function listPluginActions({ slot, targetType, targetId }) {
  const query = new URLSearchParams({
    slot,
    targetType,
    targetId: String(targetId),
  });
  return get(`/api/plugin-actions?${query.toString()}`);
}

export async function invokePluginAction(pluginKey, actionKey, payload) {
  return post(
    `/api/plugin-actions/${encodeURIComponent(pluginKey)}/${encodeURIComponent(actionKey)}/invoke`,
    payload,
  );
}

import { del, get, post, put } from "./client.js";

export async function listPlugins() {
  return get("/api/plugins");
}

export async function getPlugin(pluginKey) {
  return get(`/api/plugins/${encodeURIComponent(pluginKey)}`);
}

export async function getPluginSettings(pluginKey) {
  return get(`/api/plugins/${encodeURIComponent(pluginKey)}/settings`);
}

export async function updatePluginSettings(pluginKey, values) {
  return put(`/api/plugins/${encodeURIComponent(pluginKey)}/settings`, { values });
}

export async function enablePlugin(pluginKey) {
  return post(`/api/plugins/${encodeURIComponent(pluginKey)}/enable`, {});
}

export async function disablePlugin(pluginKey) {
  return post(`/api/plugins/${encodeURIComponent(pluginKey)}/disable`, {});
}

export async function uninstallPlugin(pluginKey) {
  return del(`/api/plugins/${encodeURIComponent(pluginKey)}`);
}

export async function previewPluginInstall(file) {
  const formData = new FormData();
  formData.append("file", file);
  return post("/api/plugins/preview-install", formData);
}

export async function installPlugin(file) {
  const formData = new FormData();
  formData.append("file", file);
  return post("/api/plugins/install", formData);
}

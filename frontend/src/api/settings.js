/**
 * Settings API — per-user preferences and admin-only global settings.
 *
 * User settings endpoints (any authenticated user):
 *   GET /api/settings        — retrieve own settings
 *   PUT /api/settings        — update own settings
 *
 * Global settings endpoints (admin only):
 *   GET /api/settings/global — retrieve singleton global settings
 *   PUT /api/settings/global — update global settings
 */

import { get, put, post, patch, del } from "./client.js";

/**
 * Retrieve the authenticated user's own settings.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getSettings() {
  return get("/api/settings");
}

/**
 * Update the authenticated user's own settings (partial updates supported).
 *
 * @param {object} settingsData — matches UserSettingsUpdate schema
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateSettings(settingsData) {
  return put("/api/settings", settingsData);
}

/**
 * Retrieve the singleton global settings row (admin only).
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getGlobalSettings() {
  return get("/api/settings/global");
}

/**
 * Update global settings (admin only, partial updates supported).
 *
 * @param {object} settingsData — matches GlobalSettingsUpdate schema
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateGlobalSettings(settingsData) {
  return put("/api/settings/global", settingsData);
}

/**
 * Retrieve the public subset of global settings (any authenticated user).
 * Returns only mandatory_fields and notification_days.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getGlobalSettingsPublic() {
  return get("/api/settings/global/public");
}

/**
 * Send a test email using the current SMTP settings (admin only).
 *
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function sendTestEmail() {
  return post("/api/settings/global/test-email");
}

/**
 * Manually trigger the daily notification run (admin only).
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function triggerNotifications() {
  return post("/api/settings/global/trigger-notifications");
}

/**
 * Immediately create a database backup (admin only).
 *
 * @returns {Promise<{ data: { filename: string, path: string } | null, error: string | null }>}
 */
export async function triggerBackup() {
  return post("/api/backup/trigger");
}

/**
 * List available database backup files (admin only).
 *
 * @returns {Promise<{ data: Array<{ filename: string, size_bytes: number, created_at: number }> | null, error: string | null }>}
 */
export async function listBackups() {
  return get("/api/backup/list");
}

/**
 * Upload a database backup zip and restore the database (admin only).
 * After a successful call the server will send itself SIGTERM and restart.
 *
 * @param {File} file — .zip database backup file
 * @returns {Promise<{ data: { status: string } | null, error: string | null }>}
 */
export async function restoreBackup(file) {
  const formData = new FormData();
  formData.append("file", file);
  return post("/api/backup/restore", formData);
}

// Custom field definitions (admin only)

/** @returns {Promise<{ data: Array | null, error: string | null }>} */
export async function listCustomFields() {
  return get("/api/custom-fields/");
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function createCustomField(payload) {
  return post("/api/custom-fields/", payload);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function updateCustomField(id, payload) {
  return patch(`/api/custom-fields/${id}`, payload);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function deleteCustomField(id) {
  return del(`/api/custom-fields/${id}`);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function updateCustomFieldSection(id, section) {
  return patch(`/api/custom-fields/${id}`, { section });
}

// API tokens (admin only)

/** @returns {Promise<{ data: Array | null, error: string | null }>} */
export async function listApiTokens() {
  return get("/api/api-tokens");
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function createApiToken(payload) {
  return post("/api/api-tokens", payload);
}

/** @returns {Promise<{ data: null, error: string | null }>} */
export async function revokeApiToken(id) {
  return del(`/api/api-tokens/${id}`);
}

// Webhooks (admin only)

/** @returns {Promise<{ data: Array | null, error: string | null }>} */
export async function listWebhooks() {
  return get("/api/webhooks");
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function createWebhook(payload) {
  return post("/api/webhooks", payload);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function updateWebhook(id, payload) {
  return put(`/api/webhooks/${id}`, payload);
}

/** @returns {Promise<{ data: null, error: string | null }>} */
export async function deleteWebhook(id) {
  return del(`/api/webhooks/${id}`);
}

/** @returns {Promise<{ data: Array | null, error: string | null }>} */
export async function listWebhookDeliveries(id) {
  return get(`/api/webhooks/${id}/deliveries`);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function retryWebhookDelivery(id) {
  return post(`/api/webhooks/deliveries/${id}/retry`);
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function testWebhook(id) {
  return post(`/api/webhooks/${id}/test`);
}

// Extension capabilities (admin only)

/** @returns {Promise<{ data: Array | null, error: string | null }>} */
export async function listExtensionCapabilities() {
  return get("/api/extensions/capabilities");
}

/** @returns {Promise<{ data: object | null, error: string | null }>} */
export async function upsertExtensionCapability(key, payload) {
  return put(`/api/extensions/capabilities/${key}`, payload);
}

/** @returns {Promise<{ data: null, error: string | null }>} */
export async function deleteExtensionCapability(key) {
  return del(`/api/extensions/capabilities/${key}`);
}

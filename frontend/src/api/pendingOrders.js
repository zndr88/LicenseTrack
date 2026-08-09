import { del, get, post, put } from "./client.js";

export function getPendingOrders(options = {}) {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  if (options.includeEvidenceIssues) params.set("include_evidence_issues", "true");
  const query = params.toString();
  return get(`/api/pending-orders${query ? `?${query}` : ""}`);
}
export function getPendingOrderHistory(options = {}) {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  const query = params.toString();
  return get(`/api/pending-orders/history${query ? `?${query}` : ""}`);
}
export const getPendingOrder = (id) => get(`/api/pending-orders/${id}`);
export const createPendingOrder = (data) => post("/api/pending-orders", data);
export const updatePendingOrder = (id, data) => put(`/api/pending-orders/${id}`, data);
export const deletePendingOrder = (id) => del(`/api/pending-orders/${id}`);
export const cancelPendingOrder = (id) => post(`/api/pending-orders/${id}/cancel`);
export const updatePendingOrderItem = (poId, itemId, data) =>
  put(`/api/pending-orders/${poId}/items/${itemId}`, data);
export const deletePendingOrderItem = (poId, itemId) =>
  del(`/api/pending-orders/${poId}/items/${itemId}`);

export function uploadPendingOrderDocument(orderId, file) {
  const formData = new FormData();
  formData.append("file", file);
  return post(`/api/pending-orders/${orderId}/documents`, formData);
}

export async function downloadPendingOrderDocument(documentId, filename) {
  const { data: response, error } = await get(`/api/pending-orders/documents/${documentId}/download`);
  if (error || !response) {
    return { data: null, error: error ?? "Download failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

export const deletePendingOrderDocument = (id) => del(`/api/pending-orders/documents/${id}`);

export async function convertPendingOrder(id, licenseData, file = null) {
  const formData = new FormData();
  formData.append("data", JSON.stringify(licenseData));
  if (file) formData.append("file", file);
  return post(`/api/pending-orders/${id}/convert`, formData);
}

export function batchConvertPendingOrder(id, items, file = null) {
  if (!file) return post(`/api/pending-orders/${id}/convert-all`, items);
  const formData = new FormData();
  formData.append("data", JSON.stringify(items));
  formData.append("file", file);
  return post(`/api/pending-orders/${id}/convert-all`, formData);
}

export function retryPendingOrderEvidenceTransfer(id) {
  return post(`/api/pending-orders/${id}/retry-evidence-transfer`);
}

export const addItemsToPendingOrderBulk = (poId, items) =>
  post(`/api/pending-orders/${poId}/items/bulk`, items);

export async function exportPendingOrdersCsv() {
  const { data: response, error } = await get("/api/pending-orders/export");
  if (error || !response) {
    return { data: null, error: error ?? "Export failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pending_orders_export.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

import { del, get, post, put } from "./client.js";

export const getPendingOrders = () => get("/api/pending-orders");
export const getPendingOrder = (id) => get(`/api/pending-orders/${id}`);
export const createPendingOrder = (data) => post("/api/pending-orders", data);
export const updatePendingOrder = (id, data) => put(`/api/pending-orders/${id}`, data);
export const deletePendingOrder = (id) => del(`/api/pending-orders/${id}`);
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

export async function convertPendingOrder(id, licenseData, file = null) {
  const formData = new FormData();
  formData.append("data", JSON.stringify(licenseData));
  if (file) formData.append("file", file);
  return post(`/api/pending-orders/${id}/convert`, formData);
}

export function batchConvertPendingOrder(id, items) {
  return post(`/api/pending-orders/${id}/convert-all`, items);
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

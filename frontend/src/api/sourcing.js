import { del, get, post, put } from "./client.js";

export const getSourcingItems = () => get("/api/sourcing");
export const getSourcingRequests = () => get("/api/sourcing/requests");
export const getSourcingRequestHistory = () => get("/api/sourcing/requests/history");
export const getSourcingItem = (id) => get(`/api/sourcing/${id}`);
export const createSourcingItem = (data) => post("/api/sourcing", data);
export const createSourcingRequest = (data) => post("/api/sourcing/requests", data);
export const updateSourcingRequest = (id, data) => put(`/api/sourcing/requests/${id}`, data);
export const cancelSourcingRequest = (id) => post(`/api/sourcing/requests/${id}/cancel`);
export const deleteSourcingRequest = (id) => del(`/api/sourcing/requests/${id}`);
export const addSourcingRequestItem = (id, data) => post(`/api/sourcing/requests/${id}/items`, data);
export const updateSourcingItem = (id, data) => put(`/api/sourcing/${id}`, data);
export const deleteSourcingItem = (id) => del(`/api/sourcing/${id}`);
export const convertSourcingItem = (id, data) => post(`/api/sourcing/${id}/convert`, data);
export const convertSourcingRequest = (id, data) => post(`/api/sourcing/requests/${id}/convert`, data);
export const convertFreewareSourcingItem = (id) => post(`/api/sourcing/${id}/convert-freeware`);
export const convertFreewareSourcingRequest = (id) => post(`/api/sourcing/requests/${id}/convert-freeware`);
export const mergeSourcingItems = (sourcingItemIds) => post("/api/sourcing/merge", { sourcingItemIds });

export function uploadSourcingQuoteDocument(requestId, file) {
  const formData = new FormData();
  formData.append("file", file);
  return post(`/api/sourcing/requests/${requestId}/quote-documents`, formData);
}

export async function downloadSourcingQuoteDocument(documentId, filename) {
  const { data: response, error } = await get(`/api/sourcing/quote-documents/${documentId}/download`);
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

export const deleteSourcingQuoteDocument = (id) => del(`/api/sourcing/quote-documents/${id}`);

export async function exportSourcingCsv() {
  const { data: response, error } = await get("/api/sourcing/export");
  if (error || !response) {
    return { data: null, error: error ?? "Export failed" };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "sourcing_export.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}

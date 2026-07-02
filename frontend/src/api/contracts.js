import { del, get, post, put } from "./client.js";

export const getContracts = () => get("/api/contracts");
export const getContract = (id) => get(`/api/contracts/${id}`);
export const createContract = (data) => post("/api/contracts", data);
export const updateContract = (id, data) => put(`/api/contracts/${id}`, data);
export const deleteContract = (id) => del(`/api/contracts/${id}`);
export const getContractLicenses = (id) => get(`/api/contracts/${id}/licenses`);
export const createFolder = (contractId, data) =>
    post(`/api/contracts/${contractId}/folders`, data);
export const updateFolder = (contractId, folderId, data) =>
    put(`/api/contracts/${contractId}/folders/${folderId}`, data);
export const deleteFolder = (contractId, folderId) =>
    del(`/api/contracts/${contractId}/folders/${folderId}`);

// Documents
export const getContractDocuments = (contractId) =>
    get(`/api/contracts/${contractId}/documents`);

export async function uploadContractDocument(contractId, file, folderId = null) {
  const formData = new FormData();
  formData.append("file", file);
  const url = folderId
    ? `/api/contracts/${contractId}/folders/${folderId}/documents`
    : `/api/contracts/${contractId}/documents`;
  return post(url, formData);
}

export async function downloadContractDocument(contractId, docId, filename) {
  const { data: response, error } = await get(
    `/api/contracts/${contractId}/documents/${docId}/download`
  );
  if (error || !response) return { data: null, error: error ?? "Download failed" };
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

export const deleteContractDocument = (contractId, docId) =>
    del(`/api/contracts/${contractId}/documents/${docId}`);

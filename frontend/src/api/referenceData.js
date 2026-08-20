import { del, get, patch, post } from "./client.js";

const REFERENCE_PATHS = {
  organization: ["organizations", null],
  publisher: ["organizations", "publisher"],
  supplier: ["organizations", "supplier"],
  costCentre: ["cost-centres", null],
};

function normalizeAlias(alias) {
  if (typeof alias === "string") return { name: alias };
  return {
    ...alias,
    normalizedName: alias.normalizedName ?? alias.normalized_name,
    createdAt: alias.createdAt ?? alias.created_at,
  };
}

function normalizeReference(item) {
  return {
    ...item,
    isActive: item.isActive ?? item.is_active ?? true,
    aliases: (item.aliases || []).map(normalizeAlias),
  };
}

export function normalizeReferenceSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/ς/gu, "σ");
}

export function cleanReferenceDisplay(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/** Search canonical reference data without changing the existing name payloads. */
export async function searchReferenceData(kind, search) {
  const [path, role] = REFERENCE_PATHS[kind] ?? [];
  if (!path) return { data: [], error: "Unknown reference-data kind" };
  const params = new URLSearchParams({ search });
  if (role) params.set("role", role);
  const result = await get(`/api/reference-data/${path}?${params.toString()}`);
  return result.error
    ? result
    : { data: (result.data || []).map(normalizeReference), error: null };
}

export async function getCostCentres({ active } = {}) {
  const params = new URLSearchParams();
  if (active !== undefined) params.set("active", String(active));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await get(`/api/reference-data/cost-centres${suffix}`);
  return result.error
    ? result
    : { data: (result.data || []).map(normalizeReference), error: null };
}

function referencePath(kind) {
  return kind === "organization" ? "/api/reference-data/organizations" : "/api/reference-data/cost-centres";
}

export async function listReferenceData(kind, { search = "", active } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (active !== undefined) params.set("active", String(active));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await get(`${referencePath(kind)}${suffix}`);
  return result.error ? result : { data: (result.data || []).map(normalizeReference), error: null };
}

export async function createReference(kind, payload) {
  const result = await post(referencePath(kind), payload);
  return result.error ? result : { data: normalizeReference(result.data), error: null };
}

export async function updateReference(kind, id, payload) {
  const result = await patch(`${referencePath(kind)}/${id}`, payload);
  return result.error ? result : { data: normalizeReference(result.data), error: null };
}

export async function setReferenceActive(kind, id, active) {
  const result = await post(`${referencePath(kind)}/${id}/${active ? "activate" : "deactivate"}`, {});
  return result.error ? result : { data: normalizeReference(result.data), error: null };
}

export async function deleteReference(kind, id) {
  return del(`${referencePath(kind)}/${id}`);
}

export async function addReferenceAlias(kind, id, name) {
  const result = await post(`${referencePath(kind)}/${id}/aliases`, { name });
  return result.error ? result : { data: normalizeReference(result.data), error: null };
}

export async function deleteReferenceAlias(kind, id, aliasId) {
  return del(`${referencePath(kind)}/${id}/aliases/${aliasId}`);
}

export async function mergeReferences(kind, sourceId, targetId) {
  return post(`${referencePath(kind)}/${sourceId}/merge`, { targetId });
}

export async function previewReferenceMerge(kind, sourceId, targetId) {
  return get(`${referencePath(kind)}/${sourceId}/merge-preview?target_id=${targetId}`);
}

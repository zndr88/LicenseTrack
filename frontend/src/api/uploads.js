import { get } from "./client.js";

/** GET /api/documents/upload-types - the file extensions this installation accepts. */
export async function getUploadTypes() {
  return get("/api/documents/upload-types");
}

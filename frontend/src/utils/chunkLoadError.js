// A lazily loaded part of the app could not be fetched. This happens when a
// browser tab stays open across an upgrade: the files the old page refers to
// are gone from the server. Browsers word the failure differently.
const CHUNK_LOAD_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite, for a lazy chunk's stylesheet
  /Loading (CSS )?chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  const message = typeof error === "string" ? error : error.message;
  if (typeof message !== "string") return false;
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message));
}

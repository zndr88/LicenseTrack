export const FILE_AVAILABILITY = {
  available: "available",
  missing: "missing",
  unavailable: "unavailable",
};

export function getFileAvailability(document) {
  return document?.fileAvailability ?? document?.file_availability ?? FILE_AVAILABILITY.available;
}

export function isFileAvailable(document) {
  return getFileAvailability(document) === FILE_AVAILABILITY.available;
}

export function documentAvailabilityLabel(document) {
  const availability = getFileAvailability(document);
  if (availability === FILE_AVAILABILITY.missing) return "File missing";
  if (availability === FILE_AVAILABILITY.unavailable) return "Storage unavailable";
  return "Available";
}

export function documentAvailabilityHelp(document) {
  const availability = getFileAvailability(document);
  if (availability === FILE_AVAILABILITY.missing) {
    return "The document record exists, but the file is missing from managed storage.";
  }
  if (availability === FILE_AVAILABILITY.unavailable) {
    return "The document record exists, but managed storage is unavailable.";
  }
  return "File is available for download.";
}

export function documentAvailabilitySummary(documents = []) {
  const total = documents.length;
  const available = documents.filter(isFileAvailable).length;
  const missing = documents.filter((document) => getFileAvailability(document) === FILE_AVAILABILITY.missing).length;
  const unavailable = documents.filter((document) => getFileAvailability(document) === FILE_AVAILABILITY.unavailable).length;
  return { total, available, missing, unavailable };
}

export function formatDocumentAvailabilitySummary({ total, available, missing, unavailable }) {
  if (!total) return "0 documents";
  const unavailableText = unavailable ? ` · ${unavailable} unavailable` : "";
  return `${total} document${total === 1 ? "" : "s"} · ${available} available · ${missing} missing${unavailableText}`;
}

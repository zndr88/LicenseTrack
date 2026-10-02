import { useEffect, useState } from "react";
import { getUploadTypes } from "../api/uploads.js";

// The server owns the allowed upload extensions (ALLOWED_UPLOAD_EXTENSIONS);
// file pickers read them once per page load. Until they arrive, or if the
// request fails, the picker shows every file and the server still validates.
let cachedAccept = null;
let pendingAccept = null;

function loadAccept() {
  pendingAccept ??= getUploadTypes().then(({ data }) => {
    const extensions = Array.isArray(data?.extensions) ? data.extensions : [];
    cachedAccept = extensions.join(",");
    return cachedAccept;
  });
  return pendingAccept;
}

/** The `accept` attribute for document file inputs, or undefined while unknown. */
export function useUploadAccept() {
  const [accept, setAccept] = useState(cachedAccept);
  useEffect(() => {
    if (cachedAccept !== null) return undefined;
    let active = true;
    loadAccept().then((value) => {
      if (active) setAccept(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return accept || undefined;
}

/** Test helper: forget the loaded extensions. */
export function resetUploadAcceptCache() {
  cachedAccept = null;
  pendingAccept = null;
}

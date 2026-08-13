import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadDocument,
  downloadProcurementDocument,
  previewDocument,
  previewProcurementDocument,
} from "../../../api/documents.js";
import { documentAvailabilityHelp, isFileAvailable } from "../../../utils/documentAvailability.js";
import { getPreviewFilename, isPreviewablePdf } from "../../../utils/documentPreview.js";

export function useDocumentPreview({ showError }) {
  const [documentPreview, setDocumentPreview] = useState(null);
  const previewUrlRef = useRef(null);
  const previewRequestRef = useRef(0);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const closeDocumentPreview = useCallback(() => {
    previewRequestRef.current += 1;
    revokePreviewUrl();
    setDocumentPreview(null);
  }, [revokePreviewUrl]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    revokePreviewUrl();
  }, [revokePreviewUrl]);

  const openDocumentPreview = useCallback(async (document) => {
    if (!isPreviewablePdf(document)) {
      showError(!isFileAvailable(document)
        ? documentAvailabilityHelp(document)
        : "Only PDF documents can be previewed.");
      return;
    }

    const requestId = ++previewRequestRef.current;
    revokePreviewUrl();
    setDocumentPreview({ document, url: null, loading: true });

    const { data, error } = document.scope === "po"
      ? await previewProcurementDocument(document.id)
      : await previewDocument(document.id);

    if (requestId !== previewRequestRef.current) {
      if (data?.url) URL.revokeObjectURL(data.url);
      return;
    }

    if (error || !data?.url) {
      setDocumentPreview(null);
      showError(`Preview failed: ${error ?? "PDF could not be loaded."}`);
      return;
    }

    previewUrlRef.current = data.url;
    setDocumentPreview({ document, url: data.url, loading: false });
  }, [revokePreviewUrl, showError]);

  const downloadPreviewDocument = useCallback(async (document) => {
    if (!isFileAvailable(document)) {
      showError(documentAvailabilityHelp(document));
      return;
    }

    const filename = getPreviewFilename(document);
    const { error } = document.scope === "po"
      ? await downloadProcurementDocument(document.id, filename)
      : await downloadDocument(document.id, filename);
    if (error) {
      showError(String(error).includes("document record exists") ? error : `Download failed: ${error}`);
    }
  }, [showError]);

  return {
    documentPreview,
    openDocumentPreview,
    closeDocumentPreview,
    downloadPreviewDocument,
  };
}

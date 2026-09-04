import { useCallback, useEffect, useRef, useState } from "react";
import { previewSourcingQuoteDocument } from "../../../api/sourcing.js";
import { documentAvailabilityHelp, isFileAvailable } from "../../../utils/documentAvailability.js";
import { isPreviewablePdf } from "../../../utils/documentPreview.js";

export function usePendingOrderQuotePreview({ showError }) {
  const [quotePreview, setQuotePreview] = useState(null);
  const previewUrlRef = useRef(null);
  const requestRef = useRef(0);

  const revokePreviewUrl = useCallback(() => {
    if (!previewUrlRef.current) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  const closeQuotePreview = useCallback(() => {
    requestRef.current += 1;
    revokePreviewUrl();
    setQuotePreview(null);
  }, [revokePreviewUrl]);

  useEffect(() => () => {
    requestRef.current += 1;
    revokePreviewUrl();
  }, [revokePreviewUrl]);

  const openQuotePreview = useCallback(async (document) => {
    if (!isPreviewablePdf(document)) {
      showError(!isFileAvailable(document)
        ? documentAvailabilityHelp(document)
        : "Only PDF quote documents can be previewed.");
      return;
    }

    const requestId = ++requestRef.current;
    revokePreviewUrl();
    setQuotePreview({ document, loading: true, url: null });

    const { data, error } = await previewSourcingQuoteDocument(document.id);
    if (requestId !== requestRef.current) {
      if (data?.url) URL.revokeObjectURL(data.url);
      return;
    }

    if (error || !data?.url) {
      setQuotePreview(null);
      showError(`Preview failed: ${error ?? "PDF could not be loaded."}`);
      return;
    }

    previewUrlRef.current = data.url;
    setQuotePreview({ document, loading: false, url: data.url });
  }, [revokePreviewUrl, showError]);

  return { quotePreview, openQuotePreview, closeQuotePreview };
}

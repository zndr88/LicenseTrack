import { useCallback, useEffect, useRef, useState } from "react";
import { previewContractDocument } from "../../api/contracts.js";
import { isPreviewablePdf } from "../../utils/documentPreview.js";

export function useContractDocumentPreview({ contractId, canDownloadDocuments, showError }) {
  const [preview, setPreview] = useState(null);
  const requestRef = useRef(0);
  const urlRef = useRef(null);

  const clearPreview = useCallback(() => {
    requestRef.current += 1;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    clearPreview();
    setPreview(null);
  }, [clearPreview]);

  useEffect(() => {
    closePreview();
    return clearPreview;
  }, [contractId, canDownloadDocuments, clearPreview, closePreview]);

  const openPreview = async (document) => {
    if (!canDownloadDocuments || !isPreviewablePdf(document)) return;
    clearPreview();
    const requestId = requestRef.current;
    setPreview({ contractId, document, loading: true, url: null });
    const { data, error } = await previewContractDocument(contractId, document.id);
    if (requestId !== requestRef.current) {
      if (data?.url) URL.revokeObjectURL(data.url);
      return;
    }
    if (error || !data?.url) {
      setPreview(null);
      showError?.(`Preview failed: ${error ?? "PDF could not be loaded."}`);
      return;
    }
    urlRef.current = data.url;
    setPreview({ contractId, document, loading: false, url: data.url });
  };

  return {
    preview: canDownloadDocuments && preview?.contractId === contractId ? preview : null,
    openPreview,
    closePreview,
  };
}

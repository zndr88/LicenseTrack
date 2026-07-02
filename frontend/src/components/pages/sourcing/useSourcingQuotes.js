import { useCallback, useRef } from "react";
import { queryKeys } from "../../../queryKeys.js";
import {
  downloadSourcingQuoteDocument,
  uploadSourcingQuoteDocument,
} from "../../../api/sourcing.js";

export function useSourcingQuotes({ queryClient, showToast }) {
  const quoteInputRef = useRef(null);
  const quoteTargetRef = useRef(null);

  const handleUploadQuote = useCallback((request) => {
    quoteTargetRef.current = request;
    quoteInputRef.current?.click();
  }, []);

  const handleQuoteSelected = useCallback(async (event) => {
    const file = event.target.files?.[0];
    const target = quoteTargetRef.current;
    event.target.value = "";
    if (!file || !target) return;
    const { error } = await uploadSourcingQuoteDocument(target.id, file);
    if (error) { showToast(error, "error"); return; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    showToast("Quote uploaded.", "success");
  }, [queryClient, showToast]);

  const handleDownloadQuote = useCallback(async (document) => {
    const { error } = await downloadSourcingQuoteDocument(document.id, document.originalFilename);
    if (error) showToast(error, "error");
  }, [showToast]);

  return {
    quoteInputRef,
    handleUploadQuote,
    handleQuoteSelected,
    handleDownloadQuote,
  };
}

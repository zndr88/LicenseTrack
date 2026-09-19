import { useCallback } from "react";
import { queryKeys } from "../../../queryKeys.js";
import { deleteSourcingQuoteDocument } from "../../../api/sourcing.js";

export function useSourcingQuotes({ queryClient, showToast }) {
  const handleDeleteQuote = useCallback(async (document) => {
    const { error } = await deleteSourcingQuoteDocument(document.id);
    if (error) { showToast(error, "error"); return false; }
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcingHistory });
    showToast("Quote deleted.", "success");
    return true;
  }, [queryClient, showToast]);

  return {
    handleDeleteQuote,
  };
}

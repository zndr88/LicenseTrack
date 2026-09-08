import { downloadPendingOrderDocument, previewPendingOrderDocument } from "../../api/pendingOrders.js";
import { downloadSourcingQuoteDocument, previewSourcingQuoteDocument } from "../../api/sourcing.js";
import { getPreviewFilename } from "../../utils/documentPreview.js";

export function getConversionDocuments(order) {
  const itemIds = new Set((order?.items ?? []).map((item) => item.id));
  const targetId = (document) => document.targetSourcingItemId ?? document.target_sourcing_item_id;
  const appliesToItems = (document) => targetId(document) == null || itemIds.has(targetId(document));
  const documents = (order?.documents ?? []).filter(appliesToItems).map((document) => ({
    ...document,
    documentKey: `pending-order-${document.id}`,
    sourceLabel: targetId(document) != null
      ? `Already attached · Single line item #${targetId(document)}`
      : "Already attached · Shared across this PO",
  }));
  const copiedQuoteIds = new Set(documents.map((document) => (
    document.source_sourcing_quote_document_id ?? document.sourceSourcingQuoteDocumentId
  )).filter((id) => id != null));
  const seenQuotes = new Set(copiedQuoteIds);

  for (const item of order?.items ?? []) {
    for (const document of item.quoteDocuments ?? item.quote_documents ?? []) {
      if (seenQuotes.has(document.id) || !appliesToItems(document)) continue;
      seenQuotes.add(document.id);
      const requestId = document.sourcingRequestId ?? document.sourcing_request_id;
      documents.push({
        ...document,
        category: document.category ?? "quote",
        documentKey: `sourcing-quote-${document.id}`,
        documentSource: "sourcing_quote",
        sourceLabel: [
          requestId != null ? `From sourcing request #${requestId}` : "From sourcing",
          targetId(document) != null ? `Single line item #${targetId(document)}` : null,
        ].filter(Boolean).join(" · "),
      });
    }
  }
  return documents;
}

export function previewConversionDocument(id, document) {
  return document.documentSource === "sourcing_quote"
    ? previewSourcingQuoteDocument(id)
    : previewPendingOrderDocument(id);
}

export function downloadConversionDocument(document) {
  const filename = getPreviewFilename(document);
  return document.documentSource === "sourcing_quote"
    ? downloadSourcingQuoteDocument(document.id, filename)
    : downloadPendingOrderDocument(document.id, filename);
}

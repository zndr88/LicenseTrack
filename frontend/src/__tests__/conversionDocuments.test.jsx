import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConvertAllModal from "../components/procurement/ConvertAllModal.jsx";
import ConvertPendingOrderModal from "../components/procurement/ConvertPendingOrderModal.jsx";
import { getConversionDocuments } from "../components/procurement/conversionDocuments.js";
import * as pendingOrdersApi from "../api/pendingOrders.js";
import * as sourcingApi from "../api/sourcing.js";

vi.mock("../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn().mockResolvedValue({ data: [] }),
  previewPendingOrderDocument: vi.fn().mockResolvedValue({ data: null, error: "Preview failed" }),
  downloadPendingOrderDocument: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("../api/sourcing.js", () => ({
  previewSourcingQuoteDocument: vi.fn().mockResolvedValue({ data: null, error: "Preview failed" }),
  downloadSourcingQuoteDocument: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("../hooks/useCustomFieldDefinitions.js", () => ({
  useCustomFieldDefinitions: () => ({ definitions: [], loading: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const quote = { id: 7, sourcingRequestId: 4, originalFilename: "source-quote.pdf", mimeType: "application/pdf" };

describe("conversion document aggregation", () => {
  test("combines procurement and source documents with stable keys across colliding IDs", () => {
    const documents = getConversionDocuments({
      documents: [{ id: 7, category: "purchase_order" }],
      items: [{ id: 1, quoteDocuments: [quote] }, { id: 2, quote_documents: [quote] }],
    });
    expect(documents).toHaveLength(2);
    expect(documents.map((document) => document.documentKey)).toEqual(["pending-order-7", "sourcing-quote-7"]);
    expect(documents[1]).toMatchObject({ category: "quote", sourceLabel: "From sourcing request #4" });
  });

  test.each(["source_sourcing_quote_document_id", "sourceSourcingQuoteDocumentId"])("deduplicates transferred quotes by %s", (sourceField) => {
    expect(getConversionDocuments({
      documents: [{ id: 20, category: "quote", [sourceField]: 7 }],
      items: [{ id: 1, quoteDocuments: [quote] }],
    })).toHaveLength(1);
  });

  test("preserves categories and limits Single evidence to selected line items", () => {
    const documents = getConversionDocuments({
      documents: [{ id: 20, target_sourcing_item_id: 2 }, { id: 21, targetSourcingItemId: 1 }],
      items: [{ id: 1, quoteDocuments: [
        quote,
        { ...quote, id: 8, category: "eula", targetSourcingItemId: 1 },
        { ...quote, id: 9, category: "invoice", target_sourcing_item_id: 2 },
      ] }],
    });
    expect(documents.map((document) => document.id)).toEqual([21, 7, 8]);
    expect(documents[2]).toMatchObject({ category: "eula", sourceLabel: "From sourcing request #4 · Single line item #1" });
  });

  test("keeps distinct same-named source quotes and accepts orders without documents", () => {
    expect(getConversionDocuments({ items: [{ quoteDocuments: [quote, { ...quote, id: 8 }] }] })).toHaveLength(2);
    expect(getConversionDocuments()).toEqual([]);
  });
});

describe.each([ConvertPendingOrderModal, ConvertAllModal])("conversion sourcing evidence in $name", (Modal) => {
  test("shows sourcing provenance and routes source and purchase document actions separately", async () => {
    const item = { id: 1, publisherName: "Acme", softwareDescription: "Suite", quantity: "1", estimatedUnitPrice: "10", quoteDocuments: [quote] };
    const order = { id: 1, poNumber: "PO-1", items: [item], documents: [{ id: 7, original_filename: "purchase.pdf", mime_type: "application/pdf", category: "purchase_order" }] };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><Modal
      order={order}
      prefill={{ publisherName: "Acme", softwareDescription: "Suite" }}
      licenses={[]}
      userSettings={{}}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));
    expect(screen.getByText("From sourcing request #4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview source-quote.pdf" }));
    await waitFor(() => expect(sourcingApi.previewSourcingQuoteDocument).toHaveBeenCalledWith(7));
    expect(pendingOrdersApi.previewPendingOrderDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview purchase.pdf" }));
    await waitFor(() => expect(pendingOrdersApi.previewPendingOrderDocument).toHaveBeenCalledWith(7));
    fireEvent.click(screen.getByRole("button", { name: "Download source-quote.pdf" }));
    await waitFor(() => expect(sourcingApi.downloadSourcingQuoteDocument).toHaveBeenCalledWith(7, "source-quote.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Download purchase.pdf" }));
    await waitFor(() => expect(pendingOrdersApi.downloadPendingOrderDocument).toHaveBeenCalledWith(7, "purchase.pdf"));
  });
});

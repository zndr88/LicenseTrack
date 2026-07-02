import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import React from "react";

vi.mock("../../api/licenses.js", () => ({
  getLicenses: vi.fn().mockResolvedValue({ data: [{ id: 1, licenseRef: "L-001" }], error: null }),
  getAllCustomFieldValues: vi.fn().mockResolvedValue({ data: { values: [] }, error: null }),
}));
vi.mock("../../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn().mockResolvedValue({ data: [], error: null }),
}));
vi.mock("../../api/sourcing.js", () => ({}));

import { usePendingOrdersData } from "../../components/pages/usePendingOrdersData.js";

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePendingOrdersData — licenses", () => {
  it("exposes licenses from the shared licenses query cache", async () => {
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.licenses).toHaveLength(1));
    expect(result.current.licenses[0].id).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../api/licenses.js", async (original) => ({
  ...(await original()),
  getLicenses: vi.fn().mockResolvedValue({ data: [{ id: 1, licenseType: "perpetual" }], error: null }),
}));

import { useAllLicenses } from "../../hooks/useAllLicenses.js";
import { queryKeys } from "../../queryKeys.js";

describe("useAllLicenses", () => {
  it("reads the shared licenses cache when it's already loaded", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.licenses, { licenses: [{ id: 7 }], customFieldValuesMap: new Map() });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAllLicenses(), { wrapper });
    expect(result.current.licenses.map((l) => l.id)).toEqual([7]);
  });

  it("loads the list when nothing is cached", async () => {
    const client = new QueryClient();
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAllLicenses(), { wrapper });
    await waitFor(() => expect(result.current.licenses.map((l) => l.id)).toEqual([1]));
  });
});

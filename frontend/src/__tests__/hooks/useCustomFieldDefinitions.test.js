import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../queryKeys.js";

const apiMocks = vi.hoisted(() => ({
  listCustomFields: vi.fn(),
}));

vi.mock("../../api/settings.js", () => ({
  listCustomFields: apiMocks.listCustomFields,
}));

import { useCustomFieldDefinitions } from "../../hooks/useCustomFieldDefinitions.js";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(queryClient) {
  return function wrapper({ children }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

beforeEach(() => {
  apiMocks.listCustomFields.mockReset();
});

describe("useCustomFieldDefinitions", () => {
  it("preserves loading and successful definition states", async () => {
    let resolveRequest;
    apiMocks.listCustomFields.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useCustomFieldDefinitions(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current).toMatchObject({ definitions: [], loading: true, error: null });

    resolveRequest({ data: [{ id: 1, name: "Owner" }], error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      definitions: [{ id: 1, name: "Owner" }],
      error: null,
    });
  });

  it("returns the existing empty fallback and exposes request errors", async () => {
    apiMocks.listCustomFields.mockResolvedValue({ data: null, error: "Definitions unavailable" });
    const { result } = renderHook(() => useCustomFieldDefinitions(), {
      wrapper: makeWrapper(makeQueryClient()),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions).toEqual([]);
    expect(result.current.error).toBe("Definitions unavailable");
  });

  it("deduplicates simultaneous consumers through the shared query key", async () => {
    apiMocks.listCustomFields.mockResolvedValue({ data: [{ id: 2 }], error: null });
    const queryClient = makeQueryClient();
    const wrapper = makeWrapper(queryClient);
    const first = renderHook(() => useCustomFieldDefinitions(), { wrapper });
    const second = renderHook(() => useCustomFieldDefinitions(), { wrapper });

    await waitFor(() => expect(first.result.current.definitions).toEqual([{ id: 2 }]));
    await waitFor(() => expect(second.result.current.definitions).toEqual([{ id: 2 }]));
    expect(apiMocks.listCustomFields).toHaveBeenCalledTimes(1);
  });

  it("refetches mounted consumers after definition invalidation", async () => {
    apiMocks.listCustomFields
      .mockResolvedValueOnce({ data: [{ id: 3, name: "Before" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 3, name: "After" }], error: null });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useCustomFieldDefinitions(), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.definitions[0]?.name).toBe("Before"));

    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.customFieldDefs }));

    await waitFor(() => expect(result.current.definitions[0]?.name).toBe("After"));
    expect(apiMocks.listCustomFields).toHaveBeenCalledTimes(2);
  });
});

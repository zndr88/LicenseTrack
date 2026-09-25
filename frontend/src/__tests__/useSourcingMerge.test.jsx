import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  mergeSourcingItems: vi.fn(),
  updateSourcingItem: vi.fn(),
}));

vi.mock("../api/sourcing.js", () => ({
  mergeSourcingItems: api.mergeSourcingItems,
  updateSourcingItem: api.updateSourcingItem,
}));

import { useSourcingMerge } from "../components/pages/sourcing/useSourcingMerge.js";

const NL_BE = { numberFormatLocale: "nl-BE" };
const LICENSES = [
  { id: 1, licenseMetric: "per_user", endDate: "2026-12-31", skuCode: "" },
  { id: 2, licenseMetric: "per_user", endDate: "2026-12-31", skuCode: "" },
];

function sourcingItems(first, second) {
  return [
    { id: 11, publisherName: "Acme", softwareDescription: "Suite", renewalForLicenseId: 1, quantity: first },
    { id: 12, publisherName: "Acme", softwareDescription: "Suite", renewalForLicenseId: 2, quantity: second },
  ];
}

function renderMerge(items) {
  const queryClient = { invalidateQueries: vi.fn(async () => {}) };
  const showToast = vi.fn();
  const view = renderHook(() => useSourcingMerge({
    sourcingItems: items,
    licenses: LICENSES,
    queryClient,
    showToast,
    userSettings: NL_BE,
  }));
  return { ...view, showToast };
}

describe("useSourcingMerge untouched final quantity (#63)", () => {
  beforeEach(() => {
    api.mergeSourcingItems.mockReset();
    api.updateSourcingItem.mockReset();
  });

  test.each([
    ["1000", "500", "1500", "1500"],
    ["1.5", "1", "2,5", "2.5"],
  ])("merging %s + %s pre-fills %s and keeps %s", async (first, second, prefill, total) => {
    api.mergeSourcingItems.mockResolvedValue({ data: { id: 99, quantity: total }, error: null });
    const { result } = renderMerge(sourcingItems(first, second));

    act(() => {
      result.current.toggleSelect(11);
    });
    act(() => {
      result.current.toggleSelect(12);
    });
    act(() => {
      result.current.openMergeModal();
    });
    expect(result.current.mergeQuantity).toBe(prefill);

    await act(async () => {
      await result.current.handleMerge();
    });

    await waitFor(() => expect(api.mergeSourcingItems).toHaveBeenCalledWith([11, 12]));
    expect(api.updateSourcingItem).not.toHaveBeenCalled();
  });
});

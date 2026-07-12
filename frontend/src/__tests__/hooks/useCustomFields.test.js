import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../api/settings.js", () => ({
  listCustomFields: vi.fn(),
}));

vi.mock("../../api/licenses.js", () => ({
  getCustomFieldValues: vi.fn(),
}));

import { getCustomFieldValues } from "../../api/licenses.js";
import { listCustomFields } from "../../api/settings.js";
import { useCustomFields } from "../../hooks/useCustomFields.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useCustomFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ignores stale responses after the selected license changes", async () => {
    const defs1 = deferred();
    const vals1 = deferred();
    const defs2 = deferred();
    const vals2 = deferred();

    listCustomFields
      .mockReturnValueOnce(defs1.promise)
      .mockReturnValueOnce(defs2.promise);
    getCustomFieldValues
      .mockReturnValueOnce(vals1.promise)
      .mockReturnValueOnce(vals2.promise);

    const { result, rerender } = renderHook(
      ({ licenseId }) => useCustomFields(licenseId),
      { initialProps: { licenseId: 1 } },
    );

    rerender({ licenseId: 2 });

    await act(async () => {
      defs2.resolve({ data: [{ id: 2, name: "Current" }], error: null });
      vals2.resolve({ data: { values: [{ customFieldDefId: 2, valueText: "current" }] }, error: null });
      await Promise.all([defs2.promise, vals2.promise]);
    });

    await waitFor(() => {
      expect(result.current.customFieldDefs).toEqual([{ id: 2, name: "Current" }]);
      expect(result.current.customFieldValues).toEqual([{ customFieldDefId: 2, valueText: "current" }]);
    });

    await act(async () => {
      defs1.resolve({ data: [{ id: 1, name: "Stale" }], error: null });
      vals1.resolve({ data: { values: [{ customFieldDefId: 1, valueText: "stale" }] }, error: null });
      await Promise.all([defs1.promise, vals1.promise]);
    });

    expect(result.current.customFieldDefs).toEqual([{ id: 2, name: "Current" }]);
    expect(result.current.customFieldValues).toEqual([{ customFieldDefId: 2, valueText: "current" }]);
  });
});

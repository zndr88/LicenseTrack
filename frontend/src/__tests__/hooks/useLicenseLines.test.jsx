import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useLicenseLines } from "../../hooks/useLicenseLines.js";

let seq = 0;
const emptyLine = (overrides = {}) => ({
  id: `id-${seq++}`,
  publisherName: "",
  softwareDescription: "",
  licenseType: "",
  quantity: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  costCentre: "",
  budgetOwnerEmail: "",
  isMaintenanceCompanion: false,
  parentLineId: null,
  ...overrides,
});

function setup() {
  return renderHook(() => useLicenseLines({
    emptyLine,
    userSettings: { numberFormatLocale: "en-US" },
    priceFields: { quantity: "quantity", unitPrice: "estimatedUnitPrice", total: "estimatedTotalPrice" },
  }));
}

describe("useLicenseLines", () => {
  test("addLine appends an empty line", () => {
    const { result } = setup();
    act(() => result.current.addLine());
    expect(result.current.lines).toHaveLength(1);
  });

  test("updateLine derives the total from quantity x unit price", () => {
    const { result } = setup();
    act(() => result.current.addLine());
    const id = result.current.lines[0].id;
    act(() => result.current.updateLine(id, "quantity", "10"));
    act(() => result.current.updateLine(id, "estimatedUnitPrice", "5"));
    expect(result.current.lines[0].estimatedTotalPrice).toBe("50.00");
  });

  test("addMaintenanceCompanion adds one companion and is idempotent", () => {
    const { result } = setup();
    act(() => result.current.addLine());
    const parent = result.current.lines[0];
    act(() => result.current.addMaintenanceCompanion(parent));
    act(() => result.current.addMaintenanceCompanion(parent));
    const companions = result.current.lines.filter((l) => l.isMaintenanceCompanion);
    expect(companions).toHaveLength(1);
    expect(companions[0].parentLineId).toBe(parent.id);
    expect(companions[0].licenseType).toBe("maintenance");
  });

  test("removeLine cascades to companions", () => {
    const { result } = setup();
    act(() => result.current.addLine());
    const parent = result.current.lines[0];
    act(() => result.current.addMaintenanceCompanion(parent));
    expect(result.current.lines).toHaveLength(2);
    act(() => result.current.removeLine(parent.id));
    expect(result.current.lines).toHaveLength(0);
  });

  test("applyRelationshipsToAllLines copies the given fields onto every line", () => {
    const { result } = setup();
    act(() => result.current.addLine());
    act(() => result.current.addLine());
    act(() => result.current.applyRelationshipsToAllLines({ costCentre: "CC-9", budgetOwnerEmail: "o@x.io" }));
    expect(result.current.lines.every((l) => l.costCentre === "CC-9" && l.budgetOwnerEmail === "o@x.io")).toBe(true);
  });
});

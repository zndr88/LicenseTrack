import { describe, expect, it } from "vitest";
import { OPEN_PENDING_ORDER_STATUSES, isPendingOrderOpen } from "../../utils/pendingOrderState.js";

describe("pending order state", () => {
  it("treats pending and invoice received as open", () => {
    expect(OPEN_PENDING_ORDER_STATUSES).toEqual(["pending", "invoice_received"]);
    expect(isPendingOrderOpen({ status: "pending" })).toBe(true);
    expect(isPendingOrderOpen({ status: "invoice_received" })).toBe(true);
    expect(isPendingOrderOpen({ status: "converted" })).toBe(false);
    expect(isPendingOrderOpen({ status: "cancelled" })).toBe(false);
    expect(isPendingOrderOpen(null)).toBe(false);
  });
});

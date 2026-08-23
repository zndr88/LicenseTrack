import { describe, expect, test } from "vitest";

import { sortSourcingRequests } from "../components/pages/sourcing/sourcingPageState.js";
import {
  filterAndSortPendingOrders,
  formatPoTotal,
} from "../components/pages/pendingOrders/usePendingOrdersPageState.js";

const includedSupportLine = (maintenanceCost) => ({
  currency: "EUR",
  licenseType: "perpetual",
  estimatedTotalPrice: "100.00",
  maintenanceCoverage: "included",
  maintenanceCost,
});

describe("procurement overview totals", () => {
  test("pending-order totals include separately priced support", () => {
    const order = { items: [includedSupportLine("50.00")] };

    expect(formatPoTotal(order, "en-US")).toBe("€150.00");
  });

  test("pending-order total sorting follows the displayed canonical total", () => {
    const lower = { id: 1, items: [includedSupportLine("25.00")] };
    const higher = { id: 2, items: [includedSupportLine("50.00")] };

    expect(filterAndSortPendingOrders([higher, lower], "", "totalValue", "asc").map(({ id }) => id))
      .toEqual([1, 2]);
  });

  test("sourcing total sorting includes separately priced support", () => {
    const lower = { id: 1, items: [includedSupportLine("25.00")] };
    const higher = { id: 2, items: [includedSupportLine("50.00")] };

    expect(sortSourcingRequests([higher, lower], "total", "asc").map(({ id }) => id))
      .toEqual([1, 2]);
  });
});

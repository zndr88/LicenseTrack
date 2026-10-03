import { describe, expect, it } from "vitest";
import cases from "../../../backend/tests/fixtures/currency_totals_cases.json";
import { groupLicenses } from "../components/pages/licenses/registryGrouping.js";
import { getProcurementBreakdown } from "../utils/procurementIdentity.js";
import { procurementTotalsByCurrency } from "../utils/procurementTotals.js";

const numbers = (totals) => Object.fromEntries(Object.entries(totals).map(([currency, value]) => [currency, Number(value)]));

describe.each(cases)("per-currency totals: $name", ({ lines, lineTotals, poTotals }) => {
  it("keeps both currencies in the Registry's line and PO summaries", () => {
    const [group] = groupLicenses(lines, ["poNumber"]);
    expect(group.summary.lineSumByCurrency).toEqual(numbers(lineTotals));
    expect(group.summary.poTotalByCurrency).toEqual(numbers(poTotals));
  });

  it("limits procurement breakdowns to the selected line's currency", () => {
    for (const selected of lines) {
      expect(getProcurementBreakdown(selected, lines)).toEqual({
        lineSum: Number(lineTotals[selected.currency]),
        override: selected.currency === "EUR" && poTotals.EUR !== lineTotals.EUR ? Number(poTotals.EUR) : null,
        total: Number(poTotals[selected.currency]),
      });
    }
  });

  it("keeps procurement overview line totals separated by currency", () => {
    const items = lines.map((line) => ({
      ...line, estimatedTotalPrice: String(Number(line.quantity) * Number(line.unitPrice)),
    }));
    expect(procurementTotalsByCurrency(items)).toEqual(numbers(lineTotals));
  });
});

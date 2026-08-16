import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import PoTotalOverrideModal from "../components/licenses/PoTotalOverrideModal.jsx";

describe("PoTotalOverrideModal", () => {
  test.each([
    ["en-US", "1,250.00"],
    ["de-DE", "1.250,00"],
  ])("preserves an existing grouped override for %s", async (locale, displayedValue) => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <PoTotalOverrideModal
        license={{ id: 1, poNumber: "PO-1", poTotalOverride: "1250.00", currency: "EUR" }}
        userSettings={{ numberFormatLocale: locale }}
        onSave={onSave}
        onClear={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Total PO value (EUR)");
    expect(input).toHaveValue(displayedValue);

    await user.click(screen.getByRole("button", { name: "Save override" }));

    expect(onSave).toHaveBeenCalledWith("1250.00");
  });
});

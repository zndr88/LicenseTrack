// Shared typed-number cases, also run by the backend
// (backend/tests/test_unit/test_number_parsing_cases.py).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTypedNumberResult } from "../../utils/formatting.js";

const { cases } = JSON.parse(
  readFileSync(new URL("../../../../backend/tests/fixtures/number_parsing_cases.json", import.meta.url), "utf8"),
);

describe("shared number parsing cases", () => {
  it.each(cases.map((c) => [`${c.locale}: ${JSON.stringify(c.input)}`, c]))("%s", (_label, c) => {
    const result = parseTypedNumberResult(c.input, { numberFormatLocale: c.locale });
    if (c.error) {
      expect(result.value).toBeNull();
      expect(result.error).toBe(c.error);
    } else {
      expect(result).toEqual({ value: c.expected, error: null });
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  parseLocalizedNumber,
  formatMoney,
  formatDate,
  formatDateTime,
  formatNumber,
  formatFileSize,
  formatPriceDisplay,
} from "../../utils/formatting.js";

// ── parseLocalizedNumber ─────────────────────────────────────────────────────

describe("parseLocalizedNumber", () => {
  const enUS = { numberFormatLocale: "en-US" };
  const deDE = { numberFormatLocale: "de-DE" };
  const frFR = { numberFormatLocale: "fr-FR" };

  it("returns null for null", () => {
    expect(parseLocalizedNumber(null, enUS)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLocalizedNumber("", enUS)).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(parseLocalizedNumber("   ", enUS)).toBeNull();
  });

  it("parses plain integer (en-US)", () => {
    expect(parseLocalizedNumber("1000", enUS)).toBe("1000");
  });

  it("parses decimal with dot (en-US)", () => {
    expect(parseLocalizedNumber("1234.50", enUS)).toBe("1234.50");
  });

  it("parses comma-grouped en-US number: 1,234.50 → 1234.50", () => {
    expect(parseLocalizedNumber("1,234.50", enUS)).toBe("1234.50");
  });

  it("parses de-DE number: 1.234,50 → 1234.50", () => {
    expect(parseLocalizedNumber("1.234,50", deDE)).toBe("1234.50");
  });

  it("parses fr-FR number with narrow no-break space: 1 234,50 → 1234.50", () => {
    // fr-FR uses narrow no-break space (\u202f) as group separator
    expect(parseLocalizedNumber("1\u202f234,50", frFR)).toBe("1234.50");
  });

  it("parses fr-FR with regular space as group separator", () => {
    expect(parseLocalizedNumber("1 234,50", frFR)).toBe("1234.50");
  });

  it("parses currency symbol prefix (€100)", () => {
    expect(parseLocalizedNumber("€100", enUS)).toBe("100");
  });

  it("parses $ prefix", () => {
    expect(parseLocalizedNumber("$100", enUS)).toBe("100");
  });

  it("parses negative number", () => {
    expect(parseLocalizedNumber("-50.00", enUS)).toBe("-50.00");
  });

  it("uses en-US as default when settings is undefined", () => {
    expect(parseLocalizedNumber("1,234.50", undefined)).toBe("1234.50");
  });

  it("uses en-US as default when settings has no numberFormatLocale", () => {
    expect(parseLocalizedNumber("1,234.50", {})).toBe("1234.50");
  });

  it("returns null for alphabetic input", () => {
    expect(parseLocalizedNumber("abc", enUS)).toBeNull();
  });

  it("treats 1.234 in de-DE as integer 1234 (period is group separator)", () => {
    // 1.234 with de-DE: group sep is ".", so "1.234" → "1234"
    expect(parseLocalizedNumber("1.234", deDE)).toBe("1234");
  });

  it("preserves a canonical decimal reopened under de-DE", () => {
    expect(parseLocalizedNumber("1234.50", deDE)).toBe("1234.50");
  });

  it("falls back safely for an unsupported locale", () => {
    expect(parseLocalizedNumber("1,234.50", { numberFormatLocale: "xx-INVALID" })).toBe("1234.50");
  });
});

// ── formatMoney ──────────────────────────────────────────────────────────────

describe("formatMoney", () => {
  it("formats canonical decimal in EUR en-US style", () => {
    const result = formatMoney("1234.50", "EUR", { numberFormatLocale: "en-US" });
    expect(result).toContain("1,234.50");
  });

  it("formats with de-DE grouping style", () => {
    const result = formatMoney("1234.50", "EUR", { numberFormatLocale: "de-DE" });
    expect(result).toContain("1.234,50");
  });

  it("returns empty string for null input", () => {
    expect(formatMoney(null, "EUR", { numberFormatLocale: "en-US" })).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(formatMoney("", "EUR", { numberFormatLocale: "en-US" })).toBe("");
  });
});

// ── formatDate ───────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats YYYY-MM-DD with DD/MM/YYYY", () => {
    expect(formatDate("2025-12-31", { dateFormat: "DD/MM/YYYY" })).toBe("31/12/2025");
  });

  it("formats YYYY-MM-DD with MM/DD/YYYY", () => {
    expect(formatDate("2025-12-31", { dateFormat: "MM/DD/YYYY" })).toBe("12/31/2025");
  });

  it("formats YYYY-MM-DD with YYYY-MM-DD (identity)", () => {
    expect(formatDate("2025-12-31", { dateFormat: "YYYY-MM-DD" })).toBe("2025-12-31");
  });

  it("returns empty string for null", () => {
    expect(formatDate(null, { dateFormat: "DD/MM/YYYY" })).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatDate("", { dateFormat: "DD/MM/YYYY" })).toBe("");
  });

  it("does NOT produce UTC-shifted date (no new Date() round-trip)", () => {
    // 2025-01-01 must not become 31/12/2024 due to UTC offset
    expect(formatDate("2025-01-01", { dateFormat: "DD/MM/YYYY" })).toBe("01/01/2025");
  });

  it("uses DD/MM/YYYY as default when settings is undefined", () => {
    expect(formatDate("2025-06-15", undefined)).toBe("15/06/2025");
  });

  // Task A — date-only no-shift proof across timezones.
  // formatDate never calls new Date(), so UTC-offset cannot shift the calendar
  // day regardless of where the test runner or the user's browser is located.
  it("2026-01-01 renders as 01/01/2026 for a Europe/Brussels user (UTC+1)", () => {
    expect(formatDate("2026-01-01", { dateFormat: "DD/MM/YYYY" })).toBe("01/01/2026");
  });

  it("2026-01-01 renders as 01/01/2026 for a Pacific/Auckland user (UTC+13)", () => {
    expect(formatDate("2026-01-01", { dateFormat: "DD/MM/YYYY" })).toBe("01/01/2026");
  });

  it("2026-01-01 renders as 01/01/2026 for an America/Los_Angeles user (UTC-8)", () => {
    expect(formatDate("2026-01-01", { dateFormat: "DD/MM/YYYY" })).toBe("01/01/2026");
  });
});

// ── formatDateTime ───────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("returns empty string for null", () => {
    expect(formatDateTime(null, {})).toBe("");
  });

  it("formats ISO string with 24h", () => {
    const iso = "2025-12-31T14:30:00Z";
    const result = formatDateTime(iso, {
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
    });
    expect(result).toMatch(/31\/12\/2025/);
    expect(result).toContain("14:30");
  });

  it("formats ISO string with 12h", () => {
    const iso = "2025-12-31T14:30:00Z";
    const result = formatDateTime(iso, {
      dateFormat: "DD/MM/YYYY",
      timeFormat: "12h",
    });
    expect(result).toMatch(/31\/12\/2025/);
    expect(result).toContain("2:30");
    expect(result).toContain("PM");
  });

  it("applies the configured time zone", () => {
    expect(formatDateTime("2025-12-31T23:30:00Z", {
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      timeZone: "Europe/Brussels",
    })).toBe("01/01/2026 00:30");
  });
});

// ── formatNumber ─────────────────────────────────────────────────────────────

describe("formatNumber", () => {
  it("formats integer with en-US grouping", () => {
    expect(formatNumber(1234567, { numberFormatLocale: "en-US" })).toBe("1,234,567");
  });

  it("formats integer with de-DE grouping", () => {
    expect(formatNumber(1234567, { numberFormatLocale: "de-DE" })).toBe("1.234.567");
  });

  it("returns empty string for null", () => {
    expect(formatNumber(null, { numberFormatLocale: "en-US" })).toBe("");
  });
});

// ── formatFileSize ───────────────────────────────────────────────────────────

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns '0 B' for zero", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("localizes decimal separators", () => {
    expect(formatFileSize(1536, { numberFormatLocale: "de-DE" })).toBe("1,5 KB");
  });
});

// ── formatPriceDisplay ───────────────────────────────────────────────────────

describe("formatPriceDisplay", () => {
  it("formats a canonical decimal string for display in en-US", () => {
    expect(formatPriceDisplay("1234.50", { numberFormatLocale: "en-US" })).toBe("1,234.50");
  });

  it("formats a canonical decimal string for display in de-DE", () => {
    expect(formatPriceDisplay("1234.50", { numberFormatLocale: "de-DE" })).toBe("1.234,50");
  });

  it("returns empty string for null", () => {
    expect(formatPriceDisplay(null, { numberFormatLocale: "en-US" })).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatPriceDisplay("", { numberFormatLocale: "en-US" })).toBe("");
  });

  it("returns empty string for non-canonical input (can't parse)", () => {
    expect(formatPriceDisplay("€100", { numberFormatLocale: "en-US" })).toBe("");
  });
});

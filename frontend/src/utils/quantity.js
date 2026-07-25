import { parseLocalizedNumber } from "./formatting.js";

function supportedLocale(settings) {
  const requested = settings?.numberFormatLocale ?? "en-US";
  try {
    return new Intl.NumberFormat(requested).resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

export function normalizeCanonicalQuantity(value) {
  if (value == null) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) return null;

  const [, sign, rawInteger, rawFraction = ""] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  const isZero = integer === "0" && !fraction;

  return `${sign && !isZero ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function canonicalizeQuantityInput(value, settings) {
  const parsed = parseLocalizedNumber(value, settings);
  return parsed == null ? null : normalizeCanonicalQuantity(parsed);
}

export function canonicalizePositiveQuantityInput(value, settings) {
  const canonical = canonicalizeQuantityInput(value, settings);
  if (canonical == null || canonical === "0" || canonical.startsWith("-")) return null;
  return canonical;
}

export function sumCanonicalQuantities(values) {
  const quantities = values.map(normalizeCanonicalQuantity);
  if (quantities.some((value) => value == null || value === "0" || value.startsWith("-"))) {
    return null;
  }

  const scale = quantities.reduce(
    (maximum, value) => Math.max(maximum, value.split(".")[1]?.length ?? 0),
    0
  );
  const total = quantities.reduce((sum, value) => {
    const [integer, fraction = ""] = value.split(".");
    return sum + BigInt(`${integer}${fraction.padEnd(scale, "0")}`);
  }, 0n);

  if (scale === 0) return total.toString();

  const digits = total.toString().padStart(scale + 1, "0");
  const canonical = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return normalizeCanonicalQuantity(canonical);
}

export function formatQuantity(value, settings) {
  const canonical = normalizeCanonicalQuantity(value);
  if (canonical == null) return "";

  const locale = supportedLocale(settings);
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integer, fraction = ""] = unsigned.split(".");

  try {
    const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const groupedInteger = formatter.format(BigInt(integer));
    const decimalSeparator = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? ".";
    const minusSign = new Intl.NumberFormat(locale)
      .formatToParts(-1)
      .find((part) => part.type === "minusSign")?.value ?? "-";

    return `${negative ? minusSign : ""}${groupedInteger}${fraction ? `${decimalSeparator}${fraction}` : ""}`;
  } catch {
    return canonical;
  }
}
